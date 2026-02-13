# OpenShorts Basket

Fork de OpenShorts enfocado en baloncesto para convertir videos largos de partidos en clips verticales (9:16).

## Roadmap y decisiones

- Roadmap tecnico y de producto: `ROADMAP.md`
- Preguntas abiertas, decisiones temporales y bitacora de cambios: `ROADMAP.md`

## Que hace hoy

- Reencuadre vertical con tracking para baloncesto (jugadores + balon)
- Pipeline con YOLO detect + YOLO pose
- Deteccion heuristica de eventos de tiro/canasta
- Extraccion automatica de multiples clips en `BASKETBALL_MODE=1`
- Controles en UI para:
  - cantidad de canastas (clips objetivo)
  - segundos antes del evento
  - segundos despues del evento

Limitacion importante:
- Los modelos COCO no traen clase `hoop/rim` por defecto.
- Si quieres deteccion de canasta anotada mas confiable, usa un modelo custom y define `BASKET_HOOP_CLASS_ID`.

## Como iniciar la app (local, sin Docker)

### 1) Backend

```bash
cd /path/to/openshorts-basket
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -r requirements.txt

export BASKETBALL_MODE=1
uvicorn app:app --host 0.0.0.0 --port 8000 --reload
```

### 2) Frontend

```bash
cd /path/to/openshorts-basket/dashboard
npm install
VITE_API_URL=http://localhost:8000 npm run dev -- --host 0.0.0.0 --port 5175
```

### 3) Abrir la interfaz

```bash
open http://localhost:5175
```

### 4) Uso basico en UI

1. Sube un video de partido.
2. Ajusta `Number of baskets`, `Seconds before`, `Seconds after`.
3. Click en `Generate Clips`.
4. Revisa el panel de resultados.

## Como iniciar con Docker

```bash
docker compose up --build
```

Servicios:
- Frontend: `http://localhost:5175`
- Backend: `http://localhost:8000`

## Variables de entorno (baloncesto)

- `BASKETBALL_MODE=1` -> fuerza flujo sin transcripcion/Gemini
- `BASKET_DETECT_MODEL` (default: `yolo11n.pt`)
- `BASKET_POSE_MODEL` (default: `yolo11n-pose.pt`)
- `BASKET_DETECT_CONF` (default: `0.20`)
- `BASKET_POSE_CONF` (default: `0.20`)
- `BASKET_DETECT_EVERY_N` (default: `2`)
- `BASKET_MAX_SHOTS` (default: `4`)
- `BASKET_PRE_SECONDS` (default: `4.0`)
- `BASKET_POST_SECONDS` (default: `6.0`)
- `BASKET_MIN_GAP_SECONDS` (default: `7.0`)
- `BASKET_HOOP_CLASS_ID` (opcional, recomendado con modelo custom)

## Flujo legado (opcional)

El flujo antiguo con YouTube + transcripcion + Gemini sigue existiendo en codigo, pero este fork esta orientado a baloncesto con `BASKETBALL_MODE=1`.

## Endpoints principales

- `POST /api/process`
- `GET /api/status/{job_id}`
- `POST /api/edit`
- `POST /api/subtitle`
- `POST /api/hook`
- `POST /api/translate`
- `POST /api/social/post`

## Notas

- Si ves errores de NumPy/Torch en local, usa la version pineada en `requirements.txt` (`numpy>=1.26,<2`).
- La calidad de deteccion mejora mucho si entrenas/ajustas modelos para tu camara y liga.

## Licencia

MIT
