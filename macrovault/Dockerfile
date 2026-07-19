ARG BUILD_FROM=ghcr.io/home-assistant/base:latest
FROM ${BUILD_FROM}

ARG BUILD_ARCH
ARG BUILD_VERSION

LABEL \
  io.hass.name="MacroVault" \
  io.hass.description="Local-first family meal planning app" \
  io.hass.version="${BUILD_VERSION}" \
  io.hass.type="app" \
  io.hass.arch="${BUILD_ARCH}"

RUN apk add --no-cache nginx && mkdir -p /run/nginx /app

COPY ingress.conf /etc/nginx/http.d/default.conf
COPY app/ /app/
COPY run.sh /run.sh

RUN chmod a+x /run.sh

CMD [ "/run.sh" ]
