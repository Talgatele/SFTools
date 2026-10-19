FROM node:24-bookworm-slim AS build

WORKDIR /app

COPY .npmrc package.json package-lock.json ./
RUN npm ci

COPY . .
ARG NG_BUILD_MAX_WORKERS=2
RUN cp src/env/env.prod.ts src/env/env.ts && NG_BUILD_MAX_WORKERS=$NG_BUILD_MAX_WORKERS npm run build

FROM php:8.3-apache

RUN a2enmod deflate headers rewrite
COPY docker/php.ini /usr/local/etc/php/conf.d/sftools.ini
COPY docker/apache.conf /etc/apache2/conf-available/sftools.conf
RUN a2enconf sftools

COPY --from=build /app/dist/ /var/www/html/
COPY deploy/web/ /var/www/html/

EXPOSE 80
