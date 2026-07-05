FROM grafana/grafana:13.0.3-slim AS builder

USER root

RUN cd /usr/share/grafana/public/app/plugins/datasource/ && \
    find . -maxdepth 1 -type d ! -name '.' ! -name 'prometheus' ! -name 'loki' -exec rm -rf {} +

FROM grafana/grafana:13.0.3-slim

COPY --from=builder /usr/share/grafana/public/app/plugins/datasource/ /usr/share/grafana/public/app/plugins/datasource/
