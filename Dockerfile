# Flowlab : app 100 % statique, servie par nginx.
# Construire : docker build -t flowlab .
# Lancer     : docker run -d -p 5173:80 --name flowlab flowlab   (ou : docker compose up -d)
# Puis ouvrir http://localhost:5173 (le micro, aux étapes suivantes, exige localhost ou HTTPS).
FROM nginx:1.27-alpine

COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY index.html /usr/share/nginx/html/
COPY src /usr/share/nginx/html/src

EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s CMD wget -q -O /dev/null http://127.0.0.1/ || exit 1
