# R&S Sons Accounting v2 server — docker build -t rs-sons . && docker compose up -d
FROM node:22-slim
ENV NODE_ENV=production PORT=8080 DATA_DIR=/data
WORKDIR /srv
COPY server/package.json server/package-lock.json ./server/
RUN cd server && npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY app/package.json ./app/package.json
COPY app/core ./app/core
COPY app/renderer ./app/renderer
COPY app/assets ./app/assets
COPY server ./server
RUN mkdir -p /data && chown -R node:node /data
USER node
VOLUME ["/data"]
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
WORKDIR /srv/server
CMD ["node", "server.js"]
