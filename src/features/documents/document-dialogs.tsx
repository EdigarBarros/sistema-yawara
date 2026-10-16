"use client";

import { useState } from "react";
import type { Audience, InstitutionalDocument } from "@/types";
import { services } from "@/services";
import { useAccess } from "@/hooks/use-access";
import { useAction } from "@/hooks/use-action";
import { useDirectory, useDocumentCategories } from "@/hooks/use-data";
import { errorMessage } from "@/lib/notify";
import { canMarkDocumentCurrent } from "@/lib/policies";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { FilePicker } from "@/components/shared/pickers";
import { AudiencePicker, AudienceSummary } from "@/components/shared/audience";
import { DemoNotice } from "@/components/shared/states";
import { isDemoMode } from "@/lib/mode";
import { DOC_SCOPE_LABELS, DOC_SCOPES, DOCUMENT_FILE_ACCEPT, DOCUMENT_FILE_HINT, documentFileError } from "./document-form-dialog";
import { FormAlert } from "@/components/shared/form-alert";

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  doc: InstitutionalDocument;
}

function wrap(Body: (p: Props) => React.ReactNode) {
  return function Wrapped(props: Props) {
    return (
      <Dialog open={props.open} onOpenChange={props.onOpenChange}>
        {props.open && <Body {...props} />}
      </Dialog>
    );
  };
}

function ErrorLine({ error }: { error?: string }) {
  return <FormAlert message={error} className="mt-4" />;
}

/* ----------------------------- Editar metadados ----------------------------- */

export const EditDocumentDialog = wrap(function EditBody({ onOpenChange, doc }: Props) {
  const dir = useDirectory();
  const { ctx } = useAccess();
  // "Vigente" exige documents.approve ou ser quem criou (o servidor confere de novo).
  const canValidate = !!ctx && canMarkDocumentCurrent(ctx, doc);
  const { data: categories, isError: categoriesFailed } = useDocumentCategories();
  const [form, setForm] = useState({
    name: doc.name,
    description: doc.description,
    categoryId: doc.categoryId,
    departmentId: doc.departmentId,
    status: doc.status === "archived" ? "current" : doc.status,
  });
  const [error, setError] = useState<string>();
  // Documento arquivado: a situação não aparece no formulário e não é enviada (só muda restaurando).
  // Os valores vão como argumentos: um reenvio após falha de conexão só reaproveita a requisição se nada mudou.
  const save = useAction(
    (values: typeof form) => {
      const { status, ...rest } = values;
      return services.documents.update(doc.id, doc.status === "archived" ? rest : { ...rest, status: status as "current" | "draft" });
    },
    { success: "Informações atualizadas", silentError: true },
  );
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));
  return (
    <DialogContent
      title="Editar informações"
      description="O arquivo não muda. Para trocar o arquivo, envie uma nova versão."
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            variant="primary"
            loading={save.pending}
            onClick={async () => {
              setError(undefined);
              try {
                await save.run(form);
                onOpenChange(false);
              } catch (e) {
                setError(errorMessage(e));
              }
            }}
          >
            Salvar
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Nome" required className="sm:col-span-2">
          <Input value={form.name} onChange={set("name")} />
        </Field>
        <Field label="Descrição" optional className="sm:col-span-2">
          <Textarea rows={3} value={form.description} onChange={set("description")} />
        </Field>
        <Field label="Categoria" required error={categoriesFailed ? "Não foi possível carregar as categorias. Feche e abra o formulário para tentar de novo." : undefined}>
          <Select value={form.categoryId} onChange={set("categoryId")}>
            {categories?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Departamento" required>
          <Select value={form.departmentId} onChange={set("departmentId")}>
            {dir.departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </Select>
        </Field>
        {doc.status !== "archived" && (
          <Field
            label="Situação"
            required
            hint={!canValidate && doc.status !== "current" ? "Só quem valida documentos (ou quem o criou) pode marcá-lo como vigente." : undefined}
          >
            <Select value={form.status} onChange={set("status")}>
              <option value="current" disabled={!canValidate && doc.status !== "current"}>
                Vigente
              </option>
              <option value="draft">Em elaboração</option>
            </Select>
          </Field>
        )}
      </div>
      <ErrorLine error={error} />
    </DialogContent>
  );
});

/* ------------------------------ Compartilhamento ------------------------------ */

export const ShareDocumentDialog = wrap(function ShareBody({ onOpenChange, doc }: Props) {
  const [audience, setAudience] = useState<Audience>(doc.access.scope === "department" ? { ...doc.access, departmentId: doc.departmentId } : doc.access);
  const [error, setError] = useState<string>();
  const save = useAction((value: Audience) => services.documents.setAccess(doc.id, value), { success: "Compartilhamento atualizado", silentError: true });
  return (
    <DialogContent
      size="lg"
      title="Compartilhamento"
      description={doc.name}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            variant="primary"
            loading={save.pending}
            onClick={async () => {
              setError(undefined);
              try {
                await save.run(audience);
                onOpenChange(false);
              } catch (e) {
                setError(errorMessage(e));
              }
            }}
          >
            Salvar compartilhamento
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <AudiencePicker name="share" value={audience} onChange={setAudience} scopes={[...DOC_SCOPES]} labels={DOC_SCOPE_LABELS} departmentId={doc.departmentId} />
        <div className="rounded-lg border border-line bg-sunken px-4 py-3">
          <AudienceSummary module="documents" audience={audience} departmentId={doc.departmentId} labels={DOC_SCOPE_LABELS} alwaysIncluded={[doc.createdBy]} />
          <p className="mt-2 text-[12px] text-fg-subtle">Quem enviou o documento e quem administra Documentos sempre têm acesso.</p>
        </div>
        {isDemoMode ? (
          <DemoNotice>Compartilhamento simulado. A autorização efetiva será aplicada pelo backend na Etapa 2.</DemoNotice>
        ) : (
          <p className="text-[12px] text-fg-subtle">A mudança vale na hora, inclusive para os arquivos de todas as versões. O novo público recebe um aviso na Central.</p>
        )}
      </div>
      <ErrorLine error={error} />
    </DialogContent>
  );
});

/* -------------------------------- Nova versão -------------------------------- */

export const NewVersionDialog = wrap(function VersionBody({ onOpenChange, doc }: Props) {
  const { ctx } = useAccess();
  const [file, setFile] = useState<File | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string>();
  // Documento vigente + perfil que não valida: a nova versão deixa o documento "Em elaboração" (regra do servidor).
  const needsValidation = doc.status === "current" && !(ctx && canMarkDocumentCurrent(ctx, doc));
  const save = useAction((chosen: File, text: string) => services.documents.addVersion(doc.id, chosen, text), {
    success: (d) => `Versão ${d.versions.length} enviada`,
    successDescription: (d) =>
      doc.status === "current" && d.status === "draft"
        ? "O documento ficou “Em elaboração” até que alguém que valida documentos o marque como vigente. As versões anteriores continuam disponíveis."
        : "As versões anteriores continuam disponíveis no histórico.",
    silentError: true,
  });
  return (
    <DialogContent
      title="Enviar nova versão"
      description={`Atual: versão ${doc.versions.length}. A versão anterior não será apagada.`}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            variant="primary"
            loading={save.pending}
            onClick={async () => {
              if (!file) return setError("Escolha o arquivo da nova versão.");
              const problem = documentFileError(file);
              if (problem) return setError(problem);
              setError(undefined);
              try {
                await save.run(file, note);
                onOpenChange(false);
              } catch (e) {
                setError(errorMessage(e));
              }
            }}
          >
            Enviar versão {doc.versions.length + 1}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <FilePicker
          file={file}
          onChange={(f) => {
            setFile(f);
            setError(documentFileError(f));
          }}
          accept={DOCUMENT_FILE_ACCEPT}
          hint={isDemoMode ? "Fica apenas neste navegador nesta etapa." : DOCUMENT_FILE_HINT}
        />
        <Field label="O que mudou?" optional>
          <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ex.: correção do artigo 5º aprovada em reunião" />
        </Field>
        {needsValidation && (
          <p className="rounded-lg border border-warn/30 bg-warn/[0.08] px-3.5 py-3 text-[12.5px] leading-relaxed text-fg-muted">
            Este documento está vigente. Como seu perfil não valida documentos, a nova versão deixa o documento “Em elaboração” até que alguém que valida
            documentos (ou quem o criou) o marque como vigente de novo.
          </p>
        )}
      </div>
      <ErrorLine error={error} />
    </DialogContent>
  );
});
