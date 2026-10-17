/**
 * Foto de perfil: recorta o centro da imagem em um quadrado, reduz para
 * AVATAR_PX e devolve um data URL JPEG pequeno (o servidor aceita até
 * MAX_PHOTO_CHARS caracteres). Tudo acontece no navegador; o arquivo original
 * não é enviado.
 */
export const AVATAR_PX = 192;
export const MAX_PHOTO_CHARS = 120_000;
const ACCEPTED = ["image/jpeg", "image/png", "image/webp"];

export async function imageFileToAvatar(file: File): Promise<string> {
  if (!ACCEPTED.includes(file.type)) throw new Error("Use uma foto JPG, PNG ou WebP.");
  if (file.size > 15 * 1024 * 1024) throw new Error("A foto passa de 15 MB. Escolha uma imagem menor.");
  const bitmap = await createImageBitmap(file).catch(() => {
    throw new Error("Não foi possível abrir essa imagem.");
  });
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = AVATAR_PX;
  canvas.height = AVATAR_PX;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Seu navegador não conseguiu processar a imagem.");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, AVATAR_PX, AVATAR_PX);
  bitmap.close();
  for (const quality of [0.86, 0.75, 0.6, 0.45]) {
    const url = canvas.toDataURL("image/jpeg", quality);
    if (url.length <= MAX_PHOTO_CHARS) return url;
  }
  throw new Error("Não foi possível reduzir essa imagem. Tente outra foto.");
}
