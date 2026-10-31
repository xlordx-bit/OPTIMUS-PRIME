# NirX Water Distribution Digital Twin

NirX combines a FastAPI backend for the EPANET Net3 hydraulic model and leak-detection pipeline with a React dashboard for live network monitoring and simulation.

## Run locally on Windows

Install the backend dependencies once:

```powershell
python -m venv backend\.venv
backend\.venv\Scripts\python.exe -m pip install -r backend\requirements.txt
```

Start the backend from the repository root:

```powershell
cd backend
..\.venv\Scripts\python.exe -m uvicorn main:app --host 127.0.0.1 --port 8000
```

In a second terminal, install and start the frontend:

```powershell
cd frontend
npm install --legacy-peer-deps
npm run dev
```

Open the Vite URL printed in the frontend terminal. The frontend proxies API requests to the backend at `http://127.0.0.1:8000`. Interactive API documentation is available at `http://127.0.0.1:8000/docs`.

See [frontend/README.md](./frontend/README.md) for frontend setup and API configuration details.
