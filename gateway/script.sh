#!/bin/sh
set -e

mkdir -p /etc/nginx/conf
if [ ! -f /etc/nginx/conf/server.crt ]; then
    echo "Generating self-signed SSL certificates..."
    openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
        -keyout /etc/nginx/conf/server.key \
        -out /etc/nginx/conf/server.crt \
        -subj "/C=MA/ST=Marrakesh-Safi/L=Ben Guerir/O=ft_transcendence/CN=guild-chat.tech" \
        -addext "subjectAltName=DNS:guild-chat.tech,DNS:www.guild-chat.tech,DNS:localhost,IP:127.0.0.1"
fi

# Execute the official OWASP CRS entrypoint so CRS rules are configured
exec /docker-entrypoint.sh "$@"