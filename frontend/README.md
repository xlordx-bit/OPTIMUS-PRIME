# NirX Water Intelligence frontend

The React dashboard displays the Net3 network topology and live sensor readings, and lets you run leak diagnostics, simulate a leak, and reset the digital twin.

## Run locally

Start the backend in one terminal from the repository root:

```powershell
cd backend
.\.venv\Scripts\python.exe -m uvicorn main:app --host 127.0.0.1 --port 8000
```

In another terminal, start the frontend:

```powershell
cd frontend
npm install --legacy-peer-deps
npm run dev
```

Open the Vite URL printed in the terminal. The development server proxies `/api` requests to `http://127.0.0.1:8000`, so the frontend and backend work together without additional CORS configuration.

To connect to a different API URL, set `VITE_API_BASE_URL` in a frontend `.env.local` file, for example:

```text
VITE_API_BASE_URL=http://127.0.0.1:8000
```
