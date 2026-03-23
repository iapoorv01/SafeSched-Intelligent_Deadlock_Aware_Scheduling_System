FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Entrypoint for CLI (can be changed as needed)
CMD ["python", "run_generator.py"]
