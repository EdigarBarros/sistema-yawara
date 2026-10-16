/**
 * Arquivos como LINK (implantação gratuita, sem Cloud Storage).
 *
 * A pessoa informa o nome e o link de compartilhamento do arquivo (Google
 * Drive, OneDrive…). Para não mudar os formulários, o link viaja como um File
 * do tipo "text/uri-list" cujo conteúdo é o endereço; o serviço o converte em
 * `{ link: { name, url } }` antes de chamar o servidor, que confere de novo.
 */
export const LINK_MIME = "text/uri-list";

/** Link https válido (sem usuário/senha embutidos). */
export function isSafeLink(value: string) {
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" && !!url.hostname && !url.username && !url.password;
  } catch {
    return false;
  }
}

/** Nome sugerido a partir do link (último trecho do caminho, ou o domínio). */
export function suggestedLinkName(value: string) {
  try {
    const url = new URL(value.trim());
    const last = decodeURIComponent(url.pathname.split("/").filter(Boolean).pop() ?? "");
    return last && last.length <= 80 && /[.\-_ ]/.test(last) ? last : url.hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

export function makeLinkFile(name: string, url: string): File {
  return new File([url.trim()], name.trim() || suggestedLinkName(url) || "arquivo", { type: LINK_MIME });
}

export function isLinkFile(file: File | Blob | null | undefined): boolean {
  return !!file && file.type === LINK_MIME;
}

/** Domínio do link, para exibição. */
export function linkHost(value: string) {
  try {
    return new URL(value).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}
