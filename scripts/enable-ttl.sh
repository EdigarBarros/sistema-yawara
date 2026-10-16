#!/bin/sh
# Ativa a exclusão automática (TTL) do campo expireAt. EXIGE O PLANO BLAZE.
# No plano gratuito (Spark) o Google recusa com "billing disabled" — e a
# Central funciona normalmente sem TTL (os registros só não expiram).
#
# Uso: PROJECT=<id-do-projeto> sh scripts/enable-ttl.sh
# Não apaga nada: só liga a política; a exclusão segue o expireAt de cada documento.
set -eu
: "${PROJECT:?Defina PROJECT=<id-do-projeto>}"
for group in idempotency uploads notifications auditLogs; do
  gcloud firestore fields ttls update expireAt --collection-group="$group" --enable-ttl --project="$PROJECT" --async
done
echo "Políticas de TTL solicitadas. Acompanhe em Firestore → TTL no console."
