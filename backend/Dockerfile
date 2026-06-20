FROM img.aksg.net/python/wolfi-python312:latest

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Make entrypoint executable and create uploads dir
RUN chmod +x /app/entrypoint.sh && mkdir -p /app/uploads

EXPOSE 8000

ENTRYPOINT ["/app/entrypoint.sh"]
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
