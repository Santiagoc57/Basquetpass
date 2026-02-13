import time
import cv2
import scenedetect
import subprocess
import argparse
import re
import sys
from collections import deque
from scenedetect import VideoManager, SceneManager
from scenedetect.detectors import ContentDetector
from ultralytics import YOLO
import torch
import os
import numpy as np
from tqdm import tqdm
import yt_dlp
# import whisper (replaced by faster_whisper inside function)
from google import genai
from dotenv import load_dotenv
import json

import warnings
warnings.filterwarnings("ignore", category=UserWarning, module='google.protobuf')

# Load environment variables
load_dotenv()

# --- Constants ---
ASPECT_RATIO = 9 / 16

# COCO class ids used by YOLO detect models
PERSON_CLASS_ID = 0
SPORTS_BALL_CLASS_ID = 32
# Rim/hoop is not available in COCO. Set this env var only if using a custom basketball model.
# Example: BASKET_HOOP_CLASS_ID=2
HOOP_CLASS_ID = os.environ.get("BASKET_HOOP_CLASS_ID")
HOOP_CLASS_ID = int(HOOP_CLASS_ID) if HOOP_CLASS_ID and HOOP_CLASS_ID.isdigit() else None

DETECT_CONF = float(os.environ.get("BASKET_DETECT_CONF", "0.20"))
POSE_CONF = float(os.environ.get("BASKET_POSE_CONF", "0.20"))
DETECT_EVERY_N_FRAMES = int(os.environ.get("BASKET_DETECT_EVERY_N", "2"))
DEFAULT_BASKET_MAX_SHOTS = int(os.environ.get("BASKET_MAX_SHOTS", "4"))
DEFAULT_BASKET_PRE_SECONDS = float(os.environ.get("BASKET_PRE_SECONDS", "4.0"))
DEFAULT_BASKET_POST_SECONDS = float(os.environ.get("BASKET_POST_SECONDS", "6.0"))
DEFAULT_BASKET_MIN_GAP_SECONDS = float(os.environ.get("BASKET_MIN_GAP_SECONDS", "7.0"))

GEMINI_PROMPT_TEMPLATE = """
You are a senior short-form video editor. Read the ENTIRE transcript and word-level timestamps to choose the 3–15 MOST VIRAL moments for TikTok/IG Reels/YouTube Shorts. Each clip must be between 15 and 60 seconds long.

⚠️ FFMPEG TIME CONTRACT — STRICT REQUIREMENTS:
- Return timestamps in ABSOLUTE SECONDS from the start of the video (usable in: ffmpeg -ss <start> -to <end> -i <input> ...).
- Only NUMBERS with decimal point, up to 3 decimals (examples: 0, 1.250, 17.350).
- Ensure 0 ≤ start < end ≤ VIDEO_DURATION_SECONDS.
- Each clip between 15 and 60 s (inclusive).
- Prefer starting 0.2–0.4 s BEFORE the hook and ending 0.2–0.4 s AFTER the payoff.
- Use silence moments for natural cuts; never cut in the middle of a word or phrase.
- STRICTLY FORBIDDEN to use time formats other than absolute seconds.

VIDEO_DURATION_SECONDS: {video_duration}

TRANSCRIPT_TEXT (raw):
{transcript_text}

WORDS_JSON (array of {{w, s, e}} where s/e are seconds):
{words_json}

STRICT EXCLUSIONS:
- No generic intros/outros or purely sponsorship segments unless they contain the hook.
- No clips < 15 s or > 60 s.

OUTPUT — RETURN ONLY VALID JSON (no markdown, no comments). Order clips by predicted performance (best to worst). In the descriptions, ALWAYS include a CTA like "Follow me and comment X and I'll send you the workflow" (especially if discussing an n8n workflow):
{{
  "shorts": [
    {{
      "start": <number in seconds, e.g., 12.340>,
      "end": <number in seconds, e.g., 37.900>,
      "video_description_for_tiktok": "<description for TikTok oriented to get views>",
      "video_description_for_instagram": "<description for Instagram oriented to get views>",
      "video_title_for_youtube_short": "<title for YouTube Short oriented to get views 100 chars max>",
      "viral_hook_text": "<SHORT punchy text overlay (max 10 words). MUST BE IN THE SAME LANGUAGE AS THE VIDEO TRANSCRIPT. Examples: 'POV: You realized...', 'Did you know?', 'Stop doing this!'>"
    }}
  ]
}}
"""

# --- YOLO Models ---
DETECT_MODEL_NAME = os.environ.get("BASKET_DETECT_MODEL", "yolo11n.pt")
POSE_MODEL_NAME = os.environ.get("BASKET_POSE_MODEL", "yolo11n-pose.pt")

try:
    detect_model = YOLO(DETECT_MODEL_NAME)
except Exception as e:
    print(f"⚠️ Failed to load {DETECT_MODEL_NAME}: {e}. Falling back to yolov8n.pt")
    detect_model = YOLO("yolov8n.pt")

try:
    pose_model = YOLO(POSE_MODEL_NAME)
except Exception as e:
    print(f"⚠️ Failed to load {POSE_MODEL_NAME}: {e}. Falling back to yolov8n-pose.pt")
    pose_model = YOLO("yolov8n-pose.pt")

class SmoothedCameraman:
    """
    Handles smooth camera movement.
    Simplified Logic: "Heavy Tripod"
    Only moves if the subject leaves the center safe zone.
    Moves slowly and linearly.
    """
    def __init__(self, output_width, output_height, video_width, video_height):
        self.output_width = output_width
        self.output_height = output_height
        self.video_width = video_width
        self.video_height = video_height
        
        # Initial State
        self.current_center_x = video_width / 2
        self.target_center_x = video_width / 2
        
        # Calculate crop dimensions once
        self.crop_height = video_height
        self.crop_width = int(self.crop_height * ASPECT_RATIO)
        if self.crop_width > video_width:
             self.crop_width = video_width
             self.crop_height = int(self.crop_width / ASPECT_RATIO)
             
        # Safe Zone: 20% of the video width
        # As long as the target is within this zone relative to current center, DO NOT MOVE.
        self.safe_zone_radius = self.crop_width * 0.25

    def update_target(self, target_box):
        """
        Updates the target center based on detected subject box.
        """
        if target_box:
            x, y, w, h = target_box
            self.target_center_x = x + w / 2
    
    def get_crop_box(self, force_snap=False):
        """
        Returns the (x1, y1, x2, y2) for the current frame.
        """
        if force_snap:
            self.current_center_x = self.target_center_x
        else:
            diff = self.target_center_x - self.current_center_x
            
            # SIMPLIFIED LOGIC:
            # 1. Is the target outside the safe zone?
            if abs(diff) > self.safe_zone_radius:
                # 2. If yes, move towards it slowly (Linear Speed)
                # Determine direction
                direction = 1 if diff > 0 else -1
                
                # Speed: 2 pixels per frame (Slow pan)
                # If the distance is HUGE (scene change or fast movement), speed up slightly
                if abs(diff) > self.crop_width * 0.5:
                    speed = 15.0 # Fast re-frame
                else:
                    speed = 3.0  # Slow, steady pan
                
                self.current_center_x += direction * speed
                
                # Check if we overshot (prevent oscillation)
                new_diff = self.target_center_x - self.current_center_x
                if (direction == 1 and new_diff < 0) or (direction == -1 and new_diff > 0):
                    self.current_center_x = self.target_center_x
            
            # If inside safe zone, DO NOTHING (Stationary Camera)
                
        # Clamp center
        half_crop = self.crop_width / 2
        
        if self.current_center_x - half_crop < 0:
            self.current_center_x = half_crop
        if self.current_center_x + half_crop > self.video_width:
            self.current_center_x = self.video_width - half_crop
            
        x1 = int(self.current_center_x - half_crop)
        x2 = int(self.current_center_x + half_crop)
        
        x1 = max(0, x1)
        x2 = min(self.video_width, x2)
        
        y1 = 0
        y2 = self.video_height
        
        return x1, y1, x2, y2

class BasketballSubjectTracker:
    """
    Keeps lock on one player candidate and avoids rapid target switching.
    """
    def __init__(self, stabilization_frames=15, cooldown_frames=30):
        self.active_player_id = None
        self.player_scores = {}  # {id: score}
        self.locked_counter = 0
        self.stabilization_threshold = stabilization_frames
        self.switch_cooldown = cooldown_frames
        self.last_switch_frame = -1000
        self.next_id = 0
        self.known_players = []  # [{'id': int, 'center': x, 'last_frame': int}]

    def get_target(self, player_candidates, frame_number, width):
        """
        player_candidates: list of {'box': [x,y,w,h], 'score': float}
        """
        current_candidates = []

        for player in player_candidates:
            x, _, w, _ = player['box']
            center_x = x + w / 2

            best_match_id = -1
            min_dist = width * 0.15
            for kp in self.known_players:
                if frame_number - kp['last_frame'] > 30:
                    continue
                dist = abs(center_x - kp['center'])
                if dist < min_dist:
                    min_dist = dist
                    best_match_id = kp['id']

            if best_match_id == -1:
                best_match_id = self.next_id
                self.next_id += 1

            self.known_players = [kp for kp in self.known_players if kp['id'] != best_match_id]
            self.known_players.append({'id': best_match_id, 'center': center_x, 'last_frame': frame_number})

            current_candidates.append({
                'id': best_match_id,
                'box': player['box'],
                'score': player['score']
            })

        for pid in list(self.player_scores.keys()):
            self.player_scores[pid] *= 0.85
            if self.player_scores[pid] < 0.1:
                del self.player_scores[pid]

        for cand in current_candidates:
            pid = cand['id']
            raw_score = cand['score'] / (width * width * 0.05)
            self.player_scores[pid] = self.player_scores.get(pid, 0) + raw_score

        if not current_candidates:
            return None

        best_candidate = None
        max_score = -1
        for cand in current_candidates:
            pid = cand['id']
            total_score = self.player_scores.get(pid, 0)
            if pid == self.active_player_id:
                total_score *= 3.0
            if total_score > max_score:
                max_score = total_score
                best_candidate = cand

        if best_candidate:
            target_id = best_candidate['id']
            if target_id == self.active_player_id:
                self.locked_counter += 1
                return best_candidate['box']

            if frame_number - self.last_switch_frame < self.switch_cooldown:
                old_cand = next((c for c in current_candidates if c['id'] == self.active_player_id), None)
                if old_cand:
                    return old_cand['box']

            self.active_player_id = target_id
            self.last_switch_frame = frame_number
            self.locked_counter = 0
            return best_candidate['box']

        return None


def _xyxy_to_box(x1, y1, x2, y2):
    return [int(x1), int(y1), int(x2 - x1), int(y2 - y1)]


def _box_center(box):
    x, y, w, h = box
    return (x + w / 2, y + h / 2)


def _xyxy_center(xyxy):
    x1, y1, x2, y2 = xyxy
    return ((x1 + x2) / 2, (y1 + y2) / 2)


def _bbox_iou_xyxy(a, b):
    ax1, ay1, ax2, ay2 = a
    bx1, by1, bx2, by2 = b
    inter_x1 = max(ax1, bx1)
    inter_y1 = max(ay1, by1)
    inter_x2 = min(ax2, bx2)
    inter_y2 = min(ay2, by2)
    inter_w = max(0.0, inter_x2 - inter_x1)
    inter_h = max(0.0, inter_y2 - inter_y1)
    inter_area = inter_w * inter_h
    if inter_area <= 0:
        return 0.0
    area_a = max(1.0, (ax2 - ax1) * (ay2 - ay1))
    area_b = max(1.0, (bx2 - bx1) * (by2 - by1))
    return inter_area / (area_a + area_b - inter_area)


def detect_basketball_objects(frame):
    """
    YOLO11-based detection for players, ball and (optionally) hoop.
    Hoop detection works only if your custom model has HOOP_CLASS_ID configured.
    """
    classes = [PERSON_CLASS_ID, SPORTS_BALL_CLASS_ID]
    if HOOP_CLASS_ID is not None:
        classes.append(HOOP_CLASS_ID)

    results = detect_model(frame, verbose=False, conf=DETECT_CONF, classes=classes)
    if not results:
        return {"players": [], "balls": [], "hoops": []}

    players, balls, hoops = [], [], []
    result = results[0]
    if result.boxes is None:
        return {"players": [], "balls": [], "hoops": []}

    for box in result.boxes:
        cls_id = int(box.cls[0].item())
        conf = float(box.conf[0].item())
        x1, y1, x2, y2 = [float(v) for v in box.xyxy[0].tolist()]
        xyxy = [x1, y1, x2, y2]
        obj = {
            "xyxy": xyxy,
            "box": _xyxy_to_box(x1, y1, x2, y2),
            "center": _xyxy_center(xyxy),
            "conf": conf,
        }

        if cls_id == PERSON_CLASS_ID:
            players.append(obj)
        elif cls_id == SPORTS_BALL_CLASS_ID:
            balls.append(obj)
        elif HOOP_CLASS_ID is not None and cls_id == HOOP_CLASS_ID:
            hoops.append(obj)

    players.sort(key=lambda d: d["conf"], reverse=True)
    balls.sort(key=lambda d: d["conf"], reverse=True)
    hoops.sort(key=lambda d: d["conf"], reverse=True)
    return {"players": players, "balls": balls, "hoops": hoops}


def _pose_shooting_score(keypoints_xy, keypoints_conf):
    """
    Coarse shooting cue from COCO keypoints:
    wrist above shoulder and elbow not collapsed.
    """
    if keypoints_xy is None or keypoints_conf is None:
        return 0.0

    # COCO indices
    left_shoulder, right_shoulder = 5, 6
    left_elbow, right_elbow = 7, 8
    left_wrist, right_wrist = 9, 10

    conf_th = 0.25
    valid_shoulders = [i for i in [left_shoulder, right_shoulder] if keypoints_conf[i] > conf_th]
    valid_elbows = [i for i in [left_elbow, right_elbow] if keypoints_conf[i] > conf_th]
    valid_wrists = [i for i in [left_wrist, right_wrist] if keypoints_conf[i] > conf_th]
    if not valid_shoulders or not valid_wrists:
        return 0.0

    shoulder_y = np.mean([keypoints_xy[i][1] for i in valid_shoulders])
    wrist_y = min([keypoints_xy[i][1] for i in valid_wrists])
    score = 0.0

    # In image coordinates, lower y means higher position.
    if wrist_y < shoulder_y:
        score += 0.35

    if valid_elbows:
        elbow_y = min([keypoints_xy[i][1] for i in valid_elbows])
        if elbow_y < shoulder_y + 15:
            score += 0.20

    return score


def detect_pose_candidates(frame):
    """
    YOLO11 pose pass. Returns bboxes with coarse 'shooting pose' score.
    """
    results = pose_model(frame, verbose=False, conf=POSE_CONF, classes=[PERSON_CLASS_ID])
    if not results:
        return []

    result = results[0]
    if result.boxes is None or result.keypoints is None:
        return []

    xy = result.keypoints.xy
    conf = result.keypoints.conf
    if xy is None or conf is None:
        return []

    xy_np = xy.cpu().numpy() if hasattr(xy, "cpu") else xy
    conf_np = conf.cpu().numpy() if hasattr(conf, "cpu") else conf
    pose_candidates = []
    for idx, box in enumerate(result.boxes):
        x1, y1, x2, y2 = [float(v) for v in box.xyxy[0].tolist()]
        shoot_score = _pose_shooting_score(xy_np[idx], conf_np[idx])
        pose_candidates.append({
            "xyxy": [x1, y1, x2, y2],
            "shoot_score": shoot_score,
        })
    return pose_candidates


def detect_player_candidates(frame, use_pose=True):
    """
    Build candidate players for framing from YOLO detect (+ optional pose cue).
    """
    entities = detect_basketball_objects(frame)
    pose_candidates = detect_pose_candidates(frame) if use_pose else []

    players = entities["players"]
    balls = entities["balls"]
    ball_center = balls[0]["center"] if balls else None

    candidates = []
    for player in players:
        x, y, w, h = player["box"]
        base_score = float(max(1, w * h))
        score = base_score

        # Ball proximity: player near the ball is more likely to be relevant.
        if ball_center:
            px, py = _box_center(player["box"])
            bx, by = ball_center
            dist = np.hypot(px - bx, py - by)
            score *= 1.0 + min(0.8, 240.0 / max(1.0, dist))

        # Pose cue: boost probable shooting posture.
        if pose_candidates:
            best_pose_boost = 0.0
            for pose in pose_candidates:
                iou = _bbox_iou_xyxy(player["xyxy"], pose["xyxy"])
                if iou > 0.1:
                    best_pose_boost = max(best_pose_boost, pose["shoot_score"])
            score *= 1.0 + best_pose_boost

        candidates.append({
            "box": [x, y, w, h],
            "score": score
        })

    return candidates, entities


def build_focus_box_from_point(x, y, frame_width, frame_height, box_w=220, box_h=320):
    x1 = int(max(0, x - box_w / 2))
    y1 = int(max(0, y - box_h / 2))
    x2 = int(min(frame_width, x + box_w / 2))
    y2 = int(min(frame_height, y + box_h / 2))
    return [x1, y1, max(1, x2 - x1), max(1, y2 - y1)]


def detect_shot_made(ball_history, hoop_box):
    """
    Simple shot-made heuristic using ball center trajectory and hoop proximity.
    Expects ball_history entries as (frame_idx, x, y).
    """
    if hoop_box is None or len(ball_history) < 6:
        return False

    hx1, hy1, hx2, hy2 = hoop_box
    hoop_w = max(1.0, hx2 - hx1)
    hoop_h = max(1.0, hy2 - hy1)
    hoop_cx = (hx1 + hx2) / 2.0
    hoop_cy = (hy1 + hy2) / 2.0

    track = list(ball_history)[-8:]
    xs = [p[1] for p in track]
    ys = [p[2] for p in track]

    # Ball should pass close to hoop center in X.
    x_window = max(18.0, hoop_w * 0.8)
    near_hoop_x = [abs(x - hoop_cx) <= x_window for x in xs]
    if sum(near_hoop_x) < 3:
        return False

    # Must come from above rim center and finish below it.
    above_margin = max(8.0, hoop_h * 0.35)
    below_margin = max(10.0, hoop_h * 0.55)
    came_from_above = any(y < (hoop_cy - above_margin) for y in ys)
    went_below = any(y > (hoop_cy + below_margin) for y in ys)
    if not (came_from_above and went_below):
        return False

    # Downward trajectory at the decisive window.
    dy = np.diff(ys)
    downward_votes = sum(1 for v in dy if v > 0)
    return downward_votes >= max(3, len(dy) - 2)


def detect_shot_attempt(ball_history, frame_height):
    """
    Fallback heuristic when hoop class is unavailable:
    detect a plausible shot arc apex followed by downward travel.
    """
    if len(ball_history) < 7:
        return False

    track = list(ball_history)[-10:]
    ys = [p[2] for p in track]
    min_idx = int(np.argmin(ys))
    if min_idx == 0 or min_idx == len(ys) - 1:
        return False

    before = ys[:min_idx + 1]
    after = ys[min_idx:]
    up_votes = sum(1 for v in np.diff(before) if v < 0)
    down_votes = sum(1 for v in np.diff(after) if v > 0)
    vertical_span = max(ys) - min(ys)
    apex_y = ys[min_idx]

    if apex_y > frame_height * 0.62:
        return False
    if vertical_span < frame_height * 0.06:
        return False

    return up_votes >= 2 and down_votes >= 2


def detect_basket_events(video_path, max_events=4, min_gap_sec=7.0):
    """
    Lightweight first pass to find basket timestamps.
    Priority:
    1) made-shot detection (ball + hoop)
    2) shot-attempt fallback (ball arc only)
    """
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        return []

    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    frame_h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    min_gap_frames = int(max(1.0, min_gap_sec) * fps)

    events = []
    last_event_frame = -1_000_000
    frame_idx = 0
    ball_history = deque(maxlen=max(12, int(fps * 2.5)))
    current_hoop_xyxy = None
    hoop_miss_counter = 0
    hoop_forget_after = max(10, int((fps / max(1, DETECT_EVERY_N_FRAMES)) * 2))

    while cap.isOpened():
        ret, frame = cap.read()
        if not ret:
            break

        if frame_idx % DETECT_EVERY_N_FRAMES != 0:
            frame_idx += 1
            continue

        entities = detect_basketball_objects(frame)

        if entities["hoops"]:
            current_hoop_xyxy = entities["hoops"][0]["xyxy"]
            hoop_miss_counter = 0
        else:
            hoop_miss_counter += 1
            if hoop_miss_counter >= hoop_forget_after:
                current_hoop_xyxy = None

        if entities["balls"]:
            # If hoop is known, prefer the ball closest to hoop center.
            if current_hoop_xyxy and len(entities["balls"]) > 1:
                hx = (current_hoop_xyxy[0] + current_hoop_xyxy[2]) / 2.0
                hy = (current_hoop_xyxy[1] + current_hoop_xyxy[3]) / 2.0
                best_ball = min(
                    entities["balls"],
                    key=lambda b: np.hypot(b["center"][0] - hx, b["center"][1] - hy)
                )
            else:
                best_ball = entities["balls"][0]

            bx, by = best_ball["center"]
            ball_history.append((frame_idx, bx, by))

        event_type = None
        if current_hoop_xyxy and detect_shot_made(ball_history, current_hoop_xyxy):
            event_type = "made"
        elif detect_shot_attempt(ball_history, frame_h):
            event_type = "attempt"

        if event_type and (frame_idx - last_event_frame >= min_gap_frames):
            ts = frame_idx / max(1.0, fps)
            events.append({
                "time": round(float(ts), 3),
                "type": event_type
            })
            last_event_frame = frame_idx
            print(f"🏀 Detected {event_type} event at {ts:.2f}s")
            if len(events) >= max_events:
                break

        frame_idx += 1

    cap.release()
    return events

def create_general_frame(frame, output_width, output_height):
    """
    Creates a 'General Shot' frame: 
    - Background: Blurred zoom of original
    - Foreground: Original video scaled to fit width, centered vertically.
    """
    orig_h, orig_w = frame.shape[:2]
    
    # 1. Background (Fill Height)
    # Crop center to aspect ratio
    bg_scale = output_height / orig_h
    bg_w = int(orig_w * bg_scale)
    bg_resized = cv2.resize(frame, (bg_w, output_height))
    
    # Crop center of background
    start_x = (bg_w - output_width) // 2
    if start_x < 0: start_x = 0
    background = bg_resized[:, start_x:start_x+output_width]
    if background.shape[1] != output_width:
        background = cv2.resize(background, (output_width, output_height))
        
    # Blur background
    background = cv2.GaussianBlur(background, (51, 51), 0)
    
    # 2. Foreground (Fit Width)
    scale = output_width / orig_w
    fg_h = int(orig_h * scale)
    foreground = cv2.resize(frame, (output_width, fg_h))
    
    # 3. Overlay
    y_offset = (output_height - fg_h) // 2
    
    # Clone background to avoid modifying it
    final_frame = background.copy()
    final_frame[y_offset:y_offset+fg_h, :] = foreground
    
    return final_frame

def analyze_scenes_strategy(video_path, scenes):
    """
    Analyzes each scene to determine if it should be TRACK or GENERAL.
    Basketball heuristic:
    - TRACK when players are present and composition is not too crowded.
    - GENERAL for very crowded/wide shots or when no players are detected.
    Returns list of strategies corresponding to scenes.
    """
    cap = cv2.VideoCapture(video_path)
    strategies = []
    
    if not cap.isOpened():
        return ['TRACK'] * len(scenes)
        
    for start, end in tqdm(scenes, desc="   Analyzing Scenes"):
        # Sample 3 frames (start, middle, end)
        frames_to_check = [
            start.get_frames() + 5,
            int((start.get_frames() + end.get_frames()) / 2),
            end.get_frames() - 5
        ]
        
        player_counts = []
        ball_seen = 0
        for f_idx in frames_to_check:
            cap.set(cv2.CAP_PROP_POS_FRAMES, f_idx)
            ret, frame = cap.read()
            if not ret: continue

            entities = detect_basketball_objects(frame)
            player_counts.append(len(entities["players"]))
            if entities["balls"]:
                ball_seen += 1

        avg_players = (sum(player_counts) / len(player_counts)) if player_counts else 0

        # If it's too crowded or no players are visible, prefer GENERAL.
        # If we have players and occasional ball visibility, TRACK works better for highlights.
        if avg_players < 1.0 or avg_players > 7.5:
            strategies.append('GENERAL')
        else:
            strategies.append('TRACK' if ball_seen > 0 else 'GENERAL')
            
    cap.release()
    return strategies

def detect_scenes(video_path):
    video_manager = VideoManager([video_path])
    scene_manager = SceneManager()
    scene_manager.add_detector(ContentDetector())
    video_manager.set_downscale_factor()
    video_manager.start()
    scene_manager.detect_scenes(frame_source=video_manager)
    scene_list = scene_manager.get_scene_list()
    fps = video_manager.get_framerate()
    video_manager.release()
    return scene_list, fps

def get_video_resolution(video_path):
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise IOError(f"Could not open video file {video_path}")
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    cap.release()
    return width, height


def sanitize_filename(filename):
    """Remove invalid characters from filename."""
    filename = re.sub(r'[<>:"/\\|?*]', '', filename)
    filename = filename.replace(' ', '_')
    return filename[:100]


def download_youtube_video(url, output_dir="."):
    """
    Downloads a YouTube video using yt-dlp.
    Returns the path to the downloaded video and the video title.
    """
    print(f"🔍 Debug: yt-dlp version: {yt_dlp.version.__version__}")
    print("📥 Downloading video from YouTube...")
    step_start_time = time.time()

    cookies_path = '/app/cookies.txt'
    cookies_env = os.environ.get("YOUTUBE_COOKIES")
    if cookies_env:
        print("🍪 Found YOUTUBE_COOKIES env var, creating cookies file inside container...")
        try:
            with open(cookies_path, 'w') as f:
                f.write(cookies_env)
            if os.path.exists(cookies_path):
                 print(f"   Debug: Cookies file created. Size: {os.path.getsize(cookies_path)} bytes")
                 with open(cookies_path, 'r') as f:
                     content = f.read(100)
                     print(f"   Debug: First 100 chars of cookie file: {content}")
        except Exception as e:
            print(f"⚠️ Failed to write cookies file: {e}")
            cookies_path = None
    else:
        cookies_path = None
        print("⚠️ YOUTUBE_COOKIES env var not found.")
    
    ydl_opts_info = {
        'quiet': False,
        'verbose': True,
        'no_warnings': False,
        'cookiefile': cookies_path if cookies_path else None,
        'sleep_interval_requests': 5,
        'sleep_interval': 10,
        'max_sleep_interval': 30,
        'socket_timeout': 30,
        'retries': 10,
        'nocheckcertificate': True,
        'force_ipv4': True,
        'cachedir': False,
        'extractor_args': {'youtube': {'player_client': ['web']}},
        'user_agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    }
    
    with yt_dlp.YoutubeDL(ydl_opts_info) as ydl:
        try:
            info = ydl.extract_info(url, download=False)
            video_title = info.get('title', 'youtube_video')
            sanitized_title = sanitize_filename(video_title)
        except Exception as e:
            # Force print to stderr/stdout immediately so it's captured before crash
            import sys
            import traceback
            
            # Print minimal error first to ensure something gets out
            print("🚨 YOUTUBE DOWNLOAD ERROR 🚨", file=sys.stderr)
            
            error_msg = f"""
            
❌ ================================================================= ❌
❌ FATAL ERROR: YOUTUBE DOWNLOAD FAILED
❌ ================================================================= ❌
            
REASON: YouTube has blocked the download request (Error 429/Unavailable).
        This is likely a temporary IP ban on this server.

👇 SOLUTION FOR USER 👇
---------------------------------------------------------------------
1. Download the video manually to your computer.
2. Use the 'Upload Video' tab in this app to process it.
---------------------------------------------------------------------

Technical Details: {str(e)}
            """
            # Print to both streams to ensure capture
            print(error_msg, file=sys.stdout)
            print(error_msg, file=sys.stderr)
            
            # Force flush
            sys.stdout.flush()
            sys.stderr.flush()
            
            # Wait a split second to allow buffer to drain before raising
            time.sleep(0.5)
            
            raise e
    
    output_template = os.path.join(output_dir, f'{sanitized_title}.%(ext)s')
    expected_file = os.path.join(output_dir, f'{sanitized_title}.mp4')
    if os.path.exists(expected_file):
        os.remove(expected_file)
        print(f"🗑️  Removed existing file to re-download with H.264 codec")
    
    ydl_opts = {
        'format': 'bestvideo[vcodec^=avc1][ext=mp4]+bestaudio[ext=m4a]/bestvideo[vcodec^=avc1]+bestaudio/best[ext=mp4]/best',
        'outtmpl': output_template,
        'merge_output_format': 'mp4',
        'quiet': False,
        'verbose': True,
        'no_warnings': False,
        'overwrites': True,
        'cookiefile': cookies_path if cookies_path else None
    }
    
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        ydl.download([url])
    
    downloaded_file = os.path.join(output_dir, f'{sanitized_title}.mp4')
    
    if not os.path.exists(downloaded_file):
        for f in os.listdir(output_dir):
            if f.startswith(sanitized_title) and f.endswith('.mp4'):
                downloaded_file = os.path.join(output_dir, f)
                break
    
    step_end_time = time.time()
    print(f"✅ Video downloaded in {step_end_time - step_start_time:.2f}s: {downloaded_file}")
    
    return downloaded_file, sanitized_title

def process_video_to_vertical(input_video, final_output_video):
    """
    Converts horizontal video to vertical using scene strategy + basketball-centric tracking.
    """
    script_start_time = time.time()
    
    # Define temporary file paths based on the output name
    base_name = os.path.splitext(final_output_video)[0]
    temp_video_output = f"{base_name}_temp_video.mp4"
    temp_audio_output = f"{base_name}_temp_audio.aac"
    
    # Clean up previous temp files if they exist
    if os.path.exists(temp_video_output): os.remove(temp_video_output)
    if os.path.exists(temp_audio_output): os.remove(temp_audio_output)
    if os.path.exists(final_output_video): os.remove(final_output_video)

    print(f"🎬 Processing clip: {input_video}")
    print("   Step 1: Detecting scenes...")
    scenes, fps = detect_scenes(input_video)
    
    if not scenes:
        print("   ❌ No scenes were detected. Using full video as one scene.")
        # If scene detection fails or finds nothing, treat whole video as one scene
        cap = cv2.VideoCapture(input_video)
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        cap.release()
        from scenedetect import FrameTimecode
        scenes = [(FrameTimecode(0, fps), FrameTimecode(total_frames, fps))]

    print(f"   ✅ Found {len(scenes)} scenes.")

    print("\n   🧠 Step 2: Preparing Active Tracking...")
    original_width, original_height = get_video_resolution(input_video)
    
    OUTPUT_HEIGHT = original_height
    OUTPUT_WIDTH = int(OUTPUT_HEIGHT * ASPECT_RATIO)
    if OUTPUT_WIDTH % 2 != 0:
        OUTPUT_WIDTH += 1

    # Initialize Cameraman
    cameraman = SmoothedCameraman(OUTPUT_WIDTH, OUTPUT_HEIGHT, original_width, original_height)
    
    # --- New Strategy: Per-Scene Analysis ---
    print("\n   🤖 Step 3: Analyzing Scenes for Strategy (Single vs Group)...")
    scene_strategies = analyze_scenes_strategy(input_video, scenes)
    # scene_strategies is a list of 'TRACK' or 'General' corresponding to scenes
    
    print("\n   ✂️ Step 4: Processing video frames...")
    
    command = [
        'ffmpeg', '-y', '-f', 'rawvideo', '-vcodec', 'rawvideo',
        '-s', f'{OUTPUT_WIDTH}x{OUTPUT_HEIGHT}', '-pix_fmt', 'bgr24',
        '-r', str(fps), '-i', '-', '-c:v', 'libx264',
        '-preset', 'fast', '-crf', '23', '-an', temp_video_output
    ]

    ffmpeg_process = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)

    cap = cv2.VideoCapture(input_video)
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    
    frame_number = 0
    current_scene_index = 0
    
    # Pre-calculate scene boundaries
    scene_boundaries = []
    for s_start, s_end in scenes:
        scene_boundaries.append((s_start.get_frames(), s_end.get_frames()))

    # Global tracker for basketball subject (usually shooter/ball-handler)
    subject_tracker = BasketballSubjectTracker(cooldown_frames=30)
    ball_history = deque(maxlen=max(12, int(fps * 3)))
    current_hoop_xyxy = None
    last_made_frame = -10_000

    with tqdm(total=total_frames, desc="   Processing", file=sys.stdout) as pbar:
        while cap.isOpened():
            ret, frame = cap.read()
            if not ret:
                break

            # Update Scene Index
            if current_scene_index < len(scene_boundaries):
                start_f, end_f = scene_boundaries[current_scene_index]
                if frame_number >= end_f and current_scene_index < len(scene_boundaries) - 1:
                    current_scene_index += 1
            
            # Determine Strategy for current frame based on scene
            current_strategy = scene_strategies[current_scene_index] if current_scene_index < len(scene_strategies) else 'TRACK'
            is_scene_start = (frame_number == scene_boundaries[current_scene_index][0])
            
            # Apply Strategy
            if current_strategy == 'GENERAL':
                # "Plano General" -> Blur Background + Fit Width
                output_frame = create_general_frame(frame, OUTPUT_WIDTH, OUTPUT_HEIGHT)
                
                # Reset cameraman/tracker so they don't drift while inactive
                cameraman.current_center_x = original_width / 2
                cameraman.target_center_x = original_width / 2
                if is_scene_start:
                    ball_history.clear()
                
            else:
                # "TRACK" -> focus on shooter/ball handler with smooth pan.
                
                # Run detector every N frames to keep runtime manageable on CPU.
                if frame_number % DETECT_EVERY_N_FRAMES == 0:
                    # Pose pass is expensive, so run it at half frequency.
                    use_pose = (frame_number % (DETECT_EVERY_N_FRAMES * 2) == 0)
                    candidates, entities = detect_player_candidates(frame, use_pose=use_pose)
                    target_box = subject_tracker.get_target(candidates, frame_number, original_width)

                    if target_box:
                        cameraman.update_target(target_box)
                    elif entities["balls"]:
                        bx, by = entities["balls"][0]["center"]
                        ball_focus_box = build_focus_box_from_point(
                            bx, by, original_width, original_height,
                            box_w=max(140, int(original_width * 0.14)),
                            box_h=max(200, int(original_height * 0.20))
                        )
                        cameraman.update_target(ball_focus_box)

                    if entities["balls"]:
                        bx, by = entities["balls"][0]["center"]
                        ball_history.append((frame_number, bx, by))

                    if entities["hoops"]:
                        current_hoop_xyxy = entities["hoops"][0]["xyxy"]

                    # Simple made-shot trigger based on ball trajectory near hoop.
                    if current_hoop_xyxy and detect_shot_made(ball_history, current_hoop_xyxy):
                        if frame_number - last_made_frame > int(max(8, fps * 1.5)):
                            print(f"🏀 Shot-made candidate at {frame_number / max(1.0, fps):.2f}s")
                            last_made_frame = frame_number

                # Snap camera on scene change to avoid panning from previous scene position
                x1, y1, x2, y2 = cameraman.get_crop_box(force_snap=is_scene_start)
                
                # Crop
                if y2 > y1 and x2 > x1:
                    cropped = frame[y1:y2, x1:x2]
                    output_frame = cv2.resize(cropped, (OUTPUT_WIDTH, OUTPUT_HEIGHT))
                else:
                    output_frame = cv2.resize(frame, (OUTPUT_WIDTH, OUTPUT_HEIGHT))

            ffmpeg_process.stdin.write(output_frame.tobytes())
            frame_number += 1
            pbar.update(1)
    
    ffmpeg_process.stdin.close()
    stderr_output = ffmpeg_process.stderr.read().decode()
    ffmpeg_process.wait()
    cap.release()

    if ffmpeg_process.returncode != 0:
        print("\n   ❌ FFmpeg frame processing failed.")
        print("   Stderr:", stderr_output)
        return False

    print("\n   🔊 Step 5: Extracting audio...")
    audio_extract_command = [
        'ffmpeg', '-y', '-i', input_video, '-vn', '-acodec', 'copy', temp_audio_output
    ]
    try:
        subprocess.run(audio_extract_command, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    except subprocess.CalledProcessError:
        print("\n   ❌ Audio extraction failed (maybe no audio?). Proceeding without audio.")
        pass

    print("\n   ✨ Step 6: Merging...")
    if os.path.exists(temp_audio_output):
        merge_command = [
            'ffmpeg', '-y', '-i', temp_video_output, '-i', temp_audio_output,
            '-c:v', 'copy', '-c:a', 'copy', final_output_video
        ]
    else:
         merge_command = [
            'ffmpeg', '-y', '-i', temp_video_output,
            '-c:v', 'copy', final_output_video
        ]
        
    try:
        subprocess.run(merge_command, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
        print(f"   ✅ Clip saved to {final_output_video}")
    except subprocess.CalledProcessError as e:
        print("\n   ❌ Final merge failed.")
        print("   Stderr:", e.stderr.decode())
        return False

    # Clean up temp files
    if os.path.exists(temp_video_output): os.remove(temp_video_output)
    if os.path.exists(temp_audio_output): os.remove(temp_audio_output)
    
    return True

def transcribe_video(video_path):
    print("🎙️  Transcribing video with Faster-Whisper (CPU Optimized)...")
    from faster_whisper import WhisperModel
    
    # Run on CPU with INT8 quantization for speed
    model = WhisperModel("base", device="cpu", compute_type="int8")
    
    segments, info = model.transcribe(video_path, word_timestamps=True)
    
    print(f"   Detected language '{info.language}' with probability {info.language_probability:.2f}")
    
    # Convert to openai-whisper compatible format
    transcript_segments = []
    full_text = ""
    
    for segment in segments:
        # Print progress to keep user informed (and prevent timeouts feeling)
        print(f"   [{segment.start:.2f}s -> {segment.end:.2f}s] {segment.text}")
        
        seg_dict = {
            'text': segment.text,
            'start': segment.start,
            'end': segment.end,
            'words': []
        }
        
        if segment.words:
            for word in segment.words:
                seg_dict['words'].append({
                    'word': word.word,
                    'start': word.start,
                    'end': word.end,
                    'probability': word.probability
                })
        
        transcript_segments.append(seg_dict)
        full_text += segment.text + " "
        
    return {
        'text': full_text.strip(),
        'segments': transcript_segments,
        'language': info.language
    }

def get_viral_clips(transcript_result, video_duration):
    print("🤖  Analyzing with Gemini...")
    
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        print("❌ Error: GEMINI_API_KEY not found in environment variables.")
        return None


    client = genai.Client(api_key=api_key)
    
    # We use gemini-2.5-flash as requested.
    model_name = 'gemini-2.5-flash' 
    
    print(f"🤖  Initializing Gemini with model: {model_name}")

    # Extract words
    words = []
    for segment in transcript_result['segments']:
        for word in segment.get('words', []):
            words.append({
                'w': word['word'],
                's': word['start'],
                'e': word['end']
            })

    prompt = GEMINI_PROMPT_TEMPLATE.format(
        video_duration=video_duration,
        transcript_text=json.dumps(transcript_result['text']),
        words_json=json.dumps(words)
    )

    try:
        response = client.models.generate_content(
            model=model_name,
            contents=prompt
        )
        
        # --- Cost Calculation ---
        try:
            usage = response.usage_metadata
            if usage:
                # Gemini 2.5 Flash Pricing (Dec 2025)
                # Input: $0.10 per 1M tokens
                # Output: $0.40 per 1M tokens
                
                input_price_per_million = 0.10
                output_price_per_million = 0.40
                
                prompt_tokens = usage.prompt_token_count
                output_tokens = usage.candidates_token_count
                
                input_cost = (prompt_tokens / 1_000_000) * input_price_per_million
                output_cost = (output_tokens / 1_000_000) * output_price_per_million
                total_cost = input_cost + output_cost
                
                cost_analysis = {
                    "input_tokens": prompt_tokens,
                    "output_tokens": output_tokens,
                    "input_cost": input_cost,
                    "output_cost": output_cost,
                    "total_cost": total_cost,
                    "model": model_name
                }

                print(f"💰 Token Usage ({model_name}):")
                print(f"   - Input Tokens: {prompt_tokens} (${input_cost:.6f})")
                print(f"   - Output Tokens: {output_tokens} (${output_cost:.6f})")
                print(f"   - Total Estimated Cost: ${total_cost:.6f}")
                
        except Exception as e:
            print(f"⚠️ Could not calculate cost: {e}")
            cost_analysis = None
        # ------------------------

        # Clean response if it contains markdown code blocks
        text = response.text
        if text.startswith("```json"):
            text = text[7:]
        if text.endswith("```"):
            text = text[:-3]
        text = text.strip()
        
        result_json = json.loads(text)
        if cost_analysis:
            result_json['cost_analysis'] = cost_analysis
            
        return result_json
    except Exception as e:
        print(f"❌ Gemini Error: {e}")
        return None

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description="AutoCrop-Vertical with Viral Clip Detection.")
    
    input_group = parser.add_mutually_exclusive_group(required=True)
    input_group.add_argument('-i', '--input', type=str, help="Path to the input video file.")
    input_group.add_argument('-u', '--url', type=str, help="YouTube URL to download and process.")
    
    parser.add_argument('-o', '--output', type=str, help="Output directory or file (if processing whole video).")
    parser.add_argument('--keep-original', action='store_true', help="Keep the downloaded YouTube video.")
    parser.add_argument('--skip-analysis', action='store_true', help="Skip AI analysis and convert the whole video.")
    parser.add_argument('--basket-max-shots', type=int, default=None, help="Max basketball events/clips in skip-analysis mode.")
    parser.add_argument('--basket-pre-seconds', type=float, default=None, help="Seconds before detected basket event.")
    parser.add_argument('--basket-post-seconds', type=float, default=None, help="Seconds after detected basket event.")
    parser.add_argument('--basket-min-gap-seconds', type=float, default=None, help="Minimum gap between detected events.")
    
    args = parser.parse_args()

    # Basketball mode: avoid transcription/Gemini path by default.
    # Useful for local environments where faster-whisper/ctranslate2 may crash.
    basketball_mode = os.environ.get("BASKETBALL_MODE", "").strip().lower() in {"1", "true", "yes", "on"}
    if basketball_mode and not args.skip_analysis:
        print("🏀 BASKETBALL_MODE enabled: forcing --skip-analysis path.")
        args.skip_analysis = True

    script_start_time = time.time()
    
    def _ensure_dir(path: str) -> str:
        """Create directory if missing and return the same path."""
        if path:
            os.makedirs(path, exist_ok=True)
        return path
    
    # 1. Get Input Video
    if args.url:
        # For multi-clip runs, treat --output as an OUTPUT DIRECTORY (create it if needed).
        # For whole-video runs (--skip-analysis), --output can be a file path.
        if args.output and not args.skip_analysis:
            output_dir = _ensure_dir(args.output)
        else:
            # If output is a directory, use it; if it's a filename, use its directory; else default "."
            if args.output and os.path.isdir(args.output):
                output_dir = args.output
            elif args.output and not os.path.isdir(args.output):
                output_dir = os.path.dirname(args.output) or "."
            else:
                output_dir = "."
        
        input_video, video_title = download_youtube_video(args.url, output_dir)
    else:
        input_video = args.input
        video_title = os.path.splitext(os.path.basename(input_video))[0]
        
        if args.output and not args.skip_analysis:
            # For multi-clip runs, treat --output as an OUTPUT DIRECTORY (create it if needed).
            output_dir = _ensure_dir(args.output)
        else:
            # If output is a directory, use it; if it's a filename, use its directory; else default to input dir.
            if args.output and os.path.isdir(args.output):
                output_dir = args.output
            elif args.output and not os.path.isdir(args.output):
                output_dir = os.path.dirname(args.output) or os.path.dirname(input_video)
            else:
                output_dir = os.path.dirname(input_video)

    if not os.path.exists(input_video):
        print(f"❌ Input file not found: {input_video}")
        exit(1)

    # 2. Decision: Analyze clips or process whole?
    if args.skip_analysis:
        print("⏩ Skipping analysis, processing entire video...")
        basket_max_shots = args.basket_max_shots if args.basket_max_shots is not None else DEFAULT_BASKET_MAX_SHOTS
        basket_pre_seconds = args.basket_pre_seconds if args.basket_pre_seconds is not None else DEFAULT_BASKET_PRE_SECONDS
        basket_post_seconds = args.basket_post_seconds if args.basket_post_seconds is not None else DEFAULT_BASKET_POST_SECONDS
        basket_min_gap_seconds = args.basket_min_gap_seconds if args.basket_min_gap_seconds is not None else DEFAULT_BASKET_MIN_GAP_SECONDS

        explicit_file_output = (
            args.output
            and not os.path.isdir(args.output)
            and os.path.splitext(args.output)[1].lower() == ".mp4"
        )

        # CLI compatibility: if user passed an explicit .mp4 output path, produce one processed file.
        if explicit_file_output:
            output_file = args.output
            output_dir = os.path.dirname(output_file) or "."
            os.makedirs(output_dir, exist_ok=True)
            success = process_video_to_vertical(input_video, output_file)
            if not success:
                print("❌ Failed processing video in --skip-analysis mode.")
                exit(1)
        else:
            # API/dashboard mode expects output directory with clip_i files + metadata.
            if args.output and os.path.isdir(args.output):
                output_dir = _ensure_dir(args.output)
            elif args.output:
                output_dir = _ensure_dir(args.output)
            else:
                output_dir = output_dir or os.path.dirname(input_video) or "."
                os.makedirs(output_dir, exist_ok=True)

            cap = cv2.VideoCapture(input_video)
            fps = cap.get(cv2.CAP_PROP_FPS)
            frame_count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
            duration = (frame_count / fps) if fps else 0.0
            cap.release()

            shorts = []
            if basketball_mode:
                target_events = max(1, int(basket_max_shots))
                print(
                    f"🏀 Detecting basketball events (target={target_events}, "
                    f"window=-{basket_pre_seconds:.1f}s/+{basket_post_seconds:.1f}s)..."
                )
                events = detect_basket_events(
                    input_video,
                    max_events=target_events,
                    min_gap_sec=basket_min_gap_seconds
                )

                for ev in events[:target_events]:
                    start = max(0.0, ev["time"] - basket_pre_seconds)
                    end = min(float(duration), ev["time"] + basket_post_seconds)
                    if end - start < 3.0:
                        continue
                    shot_label = "Basket Made" if ev["type"] == "made" else "Shot Attempt"
                    shorts.append({
                        "start": round(float(start), 3),
                        "end": round(float(end), 3),
                        "event_type": ev["type"],
                        "video_description_for_tiktok": f"{shot_label} at {ev['time']:.2f}s",
                        "video_description_for_instagram": f"{shot_label} at {ev['time']:.2f}s",
                        "video_title_for_youtube_short": f"{shot_label} - {video_title}",
                        "viral_hook_text": "Basketball highlight"
                    })

                if not shorts:
                    print("⚠️ No basket events detected. Falling back to one full-length clip.")

            if not shorts:
                shorts = [{
                    "start": 0.0,
                    "end": round(float(duration), 3),
                    "event_type": "full_video",
                    "video_description_for_tiktok": "Basketball highlight auto-generated",
                    "video_description_for_instagram": "Basketball highlight auto-generated",
                    "video_title_for_youtube_short": f"{video_title} Highlight",
                    "viral_hook_text": "Basketball highlight"
                }]

            metadata_base = video_title
            metadata = {
                "shorts": shorts,
                "transcript": {
                    "text": "",
                    "segments": [],
                    "language": "unknown"
                }
            }
            metadata_file = os.path.join(output_dir, f"{metadata_base}_metadata.json")
            with open(metadata_file, 'w') as f:
                json.dump(metadata, f, indent=2)
            print(f"   Saved metadata to {metadata_file}")

            # Process each selected clip window.
            for i, clip in enumerate(shorts):
                start = float(clip["start"])
                end = float(clip["end"])
                clip_filename = f"{metadata_base}_clip_{i+1}.mp4"
                clip_final_path = os.path.join(output_dir, clip_filename)
                clip_temp_path = os.path.join(output_dir, f"temp_{clip_filename}")

                print(f"\n🎬 Processing Basketball Clip {i+1}: {start}s - {end}s")

                source_for_vertical = input_video
                if start > 0.01 or end < (duration - 0.01):
                    cut_command = [
                        'ffmpeg', '-y',
                        '-ss', str(start),
                        '-to', str(end),
                        '-i', input_video,
                        '-c:v', 'libx264', '-crf', '18', '-preset', 'fast',
                        '-c:a', 'aac',
                        clip_temp_path
                    ]
                    subprocess.run(cut_command, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
                    source_for_vertical = clip_temp_path

                success = process_video_to_vertical(source_for_vertical, clip_final_path)
                if not success:
                    print(f"❌ Failed processing clip {i+1}")

                if os.path.exists(clip_temp_path):
                    os.remove(clip_temp_path)
    else:
        # 3. Transcribe
        transcript = transcribe_video(input_video)
        
        # Get duration
        cap = cv2.VideoCapture(input_video)
        fps = cap.get(cv2.CAP_PROP_FPS)
        frame_count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        duration = frame_count / fps
        cap.release()

        # 4. Gemini Analysis
        clips_data = get_viral_clips(transcript, duration)
        
        if not clips_data or 'shorts' not in clips_data:
            print("❌ Failed to identify clips. Converting whole video as fallback.")
            output_file = os.path.join(output_dir, f"{video_title}_vertical.mp4")
            process_video_to_vertical(input_video, output_file)
        else:
            print(f"🔥 Found {len(clips_data['shorts'])} viral clips!")
            
            # Save metadata
            clips_data['transcript'] = transcript # Save full transcript for subtitles
            metadata_file = os.path.join(output_dir, f"{video_title}_metadata.json")
            with open(metadata_file, 'w') as f:
                json.dump(clips_data, f, indent=2)
            print(f"   Saved metadata to {metadata_file}")

            # 5. Process each clip
            for i, clip in enumerate(clips_data['shorts']):
                start = clip['start']
                end = clip['end']
                print(f"\n🎬 Processing Clip {i+1}: {start}s - {end}s")
                print(f"   Title: {clip.get('video_title_for_youtube_short', 'No Title')}")
                
                # Cut clip
                clip_filename = f"{video_title}_clip_{i+1}.mp4"
                clip_temp_path = os.path.join(output_dir, f"temp_{clip_filename}")
                clip_final_path = os.path.join(output_dir, clip_filename)
                
                # ffmpeg cut
                # Using re-encoding for precision as requested by strict seconds
                cut_command = [
                    'ffmpeg', '-y', 
                    '-ss', str(start), 
                    '-to', str(end), 
                    '-i', input_video,
                    '-c:v', 'libx264', '-crf', '18', '-preset', 'fast',
                    '-c:a', 'aac',
                    clip_temp_path
                ]
                subprocess.run(cut_command, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
                
                # Process vertical
                success = process_video_to_vertical(clip_temp_path, clip_final_path)
                
                if success:
                    print(f"   ✅ Clip {i+1} ready: {clip_final_path}")
                
                # Clean up temp cut
                if os.path.exists(clip_temp_path):
                    os.remove(clip_temp_path)

    # Clean up original if requested
    if args.url and not args.keep_original and os.path.exists(input_video):
        os.remove(input_video)
        print(f"🗑️  Cleaned up downloaded video.")

    total_time = time.time() - script_start_time
    print(f"\n⏱️  Total execution time: {total_time:.2f}s")
