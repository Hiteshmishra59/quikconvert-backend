FROM node:18

RUN apt-get update && \
    apt-get install -y libreoffice

WORKDIR /app

COPY package*.json ./

RUN npm install

COPY . .

RUN mkdir uploads converted

EXPOSE 3000

CMD ["node", "server.js"]
