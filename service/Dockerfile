# Dev image: dependencies baked in; source is bind-mounted at runtime.
FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install
EXPOSE 3000
CMD ["npm", "run", "dev"]
