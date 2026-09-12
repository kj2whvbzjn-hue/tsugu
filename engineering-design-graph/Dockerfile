FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY engineering-design-graph ./engineering-design-graph
RUN npm init -y >/dev/null 2>&1 && npm install --omit=dev --no-package-lock pg@8
USER node
EXPOSE 4180
CMD ["node","engineering-design-graph/server-entry.mjs"]
