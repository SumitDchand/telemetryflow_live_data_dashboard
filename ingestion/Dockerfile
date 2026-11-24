FROM python:3.11-slim
WORKDIR /app
COPY ingestion/requirements.lock.txt ./requirements.lock.txt
RUN pip install --no-cache-dir -r requirements.lock.txt && useradd --create-home collector
COPY ingestion .
USER collector
CMD ["python","-u","main.py"]
