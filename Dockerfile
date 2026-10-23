FROM node:24-bookworm-slim AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
ARG NG_BUILD_MAX_WORKERS=2
RUN cp src/env/env.prod.ts src/env/env.ts && NG_BUILD_MAX_WORKERS=$NG_BUILD_MAX_WORKERS npm run build

FROM php:8.3-apache

# The runtime installs no PHP extensions: remove the image's extension-build
# toolchain/headers and CLI curl, then apply available Debian security updates.
RUN apt-get update \
    && apt-get purge -y --auto-remove $PHPIZE_DEPS libc6-dev linux-libc-dev curl \
    && apt-get upgrade -y --no-install-recommends \
    && rm -rf /var/lib/apt/lists/* \
    && a2enmod deflate headers rewrite
COPY docker/php.ini /usr/local/etc/php/conf.d/sftools.ini
COPY docker/apache.conf /etc/apache2/conf-available/sftools.conf
RUN a2enconf sftools
RUN mkdir -p /var/lib/sftools && chown www-data:www-data /var/lib/sftools && chmod 700 /var/lib/sftools

COPY --from=build /app/dist/ /var/www/html/
COPY deploy/web/ /var/www/html/

EXPOSE 80
