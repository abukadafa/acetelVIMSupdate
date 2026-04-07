# Build stage
FROM node:20-alpine as build
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

# Production stage
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --only=production
COPY --from=build /app/dist ./dist
# Re-copy source for tsx if needed (though dist is better for prod)
# But since start script uses 'node dist/index.js', this is perfect.

# Ensure uploads and data directories exist
RUN mkdir -p uploads data

EXPOSE 5000
CMD ["npm", "run", "start"]
