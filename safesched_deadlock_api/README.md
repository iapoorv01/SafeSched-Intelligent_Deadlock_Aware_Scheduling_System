# SafeSched Deadlock Prediction API

This is a FastAPI backend for deadlock prediction using a trained ML model.

## Structure
- backend/app/main.py — FastAPI app
- models/logistic_regression_deadlock.joblib — Trained model
- requirements.txt — Python dependencies
- Dockerfile — For container deployment

## How to Run Locally
```bash
pip install -r requirements.txt
uvicorn backend.app.main:app --host 0.0.0.0 --port 8000
```

## How to Build and Run with Docker
```bash
docker build -t safesched-deadlock-api .
docker run -p 8000:8000 safesched-deadlock-api
```

## How to Deploy on AWS (ECS/ECR or EC2)
1. Build and push Docker image to ECR
2. Create ECS service or EC2 instance
3. Run container with port 8000 open
4. Use the public endpoint for API requests

---
For Lambda/serverless, use [Mangum](https://mangum.io/) to wrap FastAPI.
