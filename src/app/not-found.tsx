import Link from "next/link";
import { BrandEmblem } from "@/components/layout/brand";

export default function NotFound() {
  return (
    <main className="atmos grid min-h-dvh place-items-center px-6 text-center">
      <div className="max-w-md">
        <BrandEmblem size={72} className="mx-auto mb-6" />
        <p className="eyebrow !text-gold-fg">Erro 404</p>
        <h1 className="mt-3 font-display text-[34px] font-bold">Página não encontrada</h1>
        <p className="mt-2 text-[14px] text-fg-muted">O endereço pode ter mudado ou não existir nesta demonstração.</p>
        <Link href="/inicio" className="mt-6 inline-flex h-[38px] items-center rounded-lg bg-gold px-4 text-[13.5px] font-semibold text-gold-ink hover:bg-gold-hover">
          Voltar para o início
        </Link>
      </div>
    </main>
  );
}
