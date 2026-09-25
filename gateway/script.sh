#!/bin/sh
set -e

mkdir -p /etc/nginx/conf
if [ -f /certs/fullchain.pem ] && [ -f /certs/privkey.pem ]; then
    if [ -r /certs/fullchain.pem ] && [ -r /certs/privkey.pem ]; then
        echo "Applying mounted Let's Encrypt certificates..."
        cp -f /certs/fullchain.pem /etc/nginx/conf/server.crt
        cp -f /certs/privkey.pem /etc/nginx/conf/server.key
    else
        echo "WARNING: /certs/privkey.pem exists but is not readable. Run 'sudo chmod 644 certs/*' on host."
    fi
elif [ -f /certs/server.crt ] && [ -f /certs/server.key ]; then
    if [ -r /certs/server.crt ] && [ -r /certs/server.key ]; then
        echo "Applying mounted custom SSL certificates..."
        cp -f /certs/server.crt /etc/nginx/conf/server.crt
        cp -f /certs/server.key /etc/nginx/conf/server.key
    else
        echo "WARNING: /certs/server.key exists but is not readable. Run 'sudo chmod 644 certs/*' on host."
    fi
fi

if [ ! -f /etc/nginx/conf/server.crt ]; then
    echo "Generating self-signed SSL certificates for guild-chat.tech..."
    openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
        -keyout /etc/nginx/conf/server.key \
        -out /etc/nginx/conf/server.crt \
        -subj "/C=MA/ST=Marrakesh-Safi/L=Ben Guerir/O=ft_transcendence/CN=guild-chat.tech" \
        -addext "subjectAltName=DNS:guild-chat.tech,DNS:www.guild-chat.tech,DNS:localhost,IP:127.0.0.1"
fi

exec /docker-entrypoint.sh "$@"