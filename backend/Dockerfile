FROM node:18-alpine
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --only=production || npm install --omit=dev
COPY . .
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=2s --retries=5 CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1
CMD ["npm", "start"]

