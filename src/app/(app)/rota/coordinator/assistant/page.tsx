import { requireRotaPage } from "@/server/auth/portals";
import { listIntakes, intakeStartOptions } from "@/server/care/coordinator/intake";
import { CsbCoordinatorWorkspace } from "@/components/coordinator/ai-workspace";
import { RotaTabs } from "@/components/rota-nav";
import { PageHeader } from "@/components/ui";
export const dynamic="force-dynamic";

/** Native AI-powered care coordination workspace; uses existing intake records. */
export default async function AiCsbCoordinatorPage({searchParams}:{searchParams:Promise<{intakeId?:string}>}){
  const ctx=await requireRotaPage("serviceUser.documents");
  const sp=await searchParams;
  const [rows,opts]=await Promise.all([listIntakes(ctx),intakeStartOptions(ctx)]);
  const cases=rows.map(r=>({id:r.id,reference:r.reference,title:r.title,status:r.status,documents:r._count.documents,
    open:r.openFacts,total:r._count.facts,person:r.person?.name??null}));
  return <>
    <PageHeader tabs={<RotaTabs ctx={ctx} ws="people" active="coordinator" />}
      title="AI CSB Coordinator" back="/rota/coordinator"
      subtitle="A connected assistant for document intake, case reviews, service-user setup and rota readiness."/>
    <CsbCoordinatorWorkspace cases={cases} initialId={sp.intakeId||null} aiEnabled={opts.reading.ai}/>
  </>;
}
