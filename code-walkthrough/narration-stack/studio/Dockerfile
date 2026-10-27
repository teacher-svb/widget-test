FROM python:3.12-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Piper runs in-process on the CPU. The studio itself only needs the standard library.
RUN pip install --no-cache-dir "piper-tts>=1.3,<2"

WORKDIR /app
COPY app/ /app/

ENV PORT=8080 \
    DATA_DIR=/data \
    LESSONS_DIR=/lessons \
    CHATTERBOX_URL=http://chatterbox:4123 \
    PYTHONUNBUFFERED=1

VOLUME ["/data"]
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD python3 -c "import urllib.request,os; urllib.request.urlopen('http://127.0.0.1:%s/api/settings' % os.environ.get('PORT','8080'), timeout=4)"

CMD ["python3", "server.py"]
