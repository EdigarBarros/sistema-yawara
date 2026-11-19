import type { Metadata } from "next";
import Link from "next/link";
import { BrandEmblem } from "@/components/layout/brand";

export const metadata: Metadata = { title: "Sobre a Central Yawara" };

/** Página pública (sem login): apresenta a Central. Exigida pelo Google para publicar o acesso ao Drive. */
export default function SobrePage() {
  return (
    <main className="atmos min-h-dvh px-6 py-12">
      <article className="mx-auto max-w-2xl space-y-5 text-[15px] leading-relaxed text-fg-muted">
        <BrandEmblem size={64} />
        <p className="eyebrow !text-gold-fg">Associação Atlética Acadêmica de Psicologia Yawara</p>
        <h1 className="font-display text-[32px] font-bold text-fg">Central Yawara</h1>
        <p>
          A Central Yawara é o sistema interno de gestão da Atlética Yawara de Psicologia. Ela reúne, para os integrantes da
          diretoria e da equipe, as campanhas e rifas, os eventos, as reuniões e atas, os documentos, o financeiro, o marketing e
          os projetos de ensino e extensão.
        </p>
        <p>
          O uso é restrito: as contas são criadas somente por convite, e cada pessoa vê e faz apenas o que o seu cargo permite.
          Não há cadastro aberto ao público.
        </p>
        <p>
          Os arquivos enviados pela Central (documentos, comprovantes e artes) podem ser guardados numa pasta privada do Google
          Drive da própria Atlética. A Central acessa somente os arquivos que ela mesma criou nessa pasta.
        </p>
        <p>
          Saiba como tratamos os dados na <Link href="/privacidade" className="font-semibold text-gold-fg hover:underline">Política de Privacidade</Link>.
          Contato: <a href="mailto:yawarapsicologia@gmail.com" className="font-semibold text-gold-fg hover:underline">yawarapsicologia@gmail.com</a>.
        </p>
        <p>
          <Link href="/login" className="font-semibold text-gold-fg hover:underline">Entrar na Central</Link>
        </p>
      </article>
    </main>
  );
}
