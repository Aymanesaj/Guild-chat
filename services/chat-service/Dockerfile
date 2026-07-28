FROM python:3.12-alpine

WORKDIR /app

RUN pip install --no-cache-dir fastapi uvicorn

COPY frontend/app/mock-server/main.py ./main.py

EXPOSE 8081

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8081"]
