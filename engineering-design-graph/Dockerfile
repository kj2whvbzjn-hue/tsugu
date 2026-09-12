FROM node:24-alpine
WORKDIR /app/engineering-design-graph
ENV NODE_ENV=production
COPY engineering-design-graph/package.json ./package.json
RUN npm install --omit=dev --no-package-lock
COPY engineering-design-graph ./
USER node
EXPOSE 4180
CMD ["npm","start"]
