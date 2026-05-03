# Use Node 20 with slim base
FROM node:20-slim

WORKDIR /app

# Copy package files first (better layer caching)
COPY package*.json ./
RUN npm install --production

# Copy application source
COPY . .

# Cloud Run sets PORT=8080 automatically; K_SERVICE triggers auto-skip of WhatsApp
EXPOSE 8080

CMD ["node", "server.js"]
