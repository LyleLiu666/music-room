import type {ServiceCaller} from './service.ts';
import type {WorkbenchService} from '../workbench/service.ts';

// Compiled by the normal build; these checks must fail if the boundary regresses to any.
function checkOperationContracts(call:ServiceCaller,web:WorkbenchService) {
  // @ts-expect-error unknown operation
  void call('invented_operation',{});
  // @ts-expect-error get_job requires jobId, not projectId
  void call('get_job',{projectId:'window-study'});
  void call('get_job',{jobId:'job-test'}).then(job=>{
    const state:'queued'|'running'|'succeeded'|'failed'|'cancelled'|'interrupted'=job.state;
    void state;
    // @ts-expect-error no invented state
    job.state='invented';
    // @ts-expect-error misspelled output field
    void job.statte;
  });
  // @ts-expect-error a revision requires its project
  void web.call('get_revision',{revisionId:'window-study-v1'});
  void web.call('get_project',{projectId:'window-study'}).then(result=>{
    const title:string=result.project.title;void title;
    // @ts-expect-error get_project does not return job state
    void result.state;
  });
}
void checkOperationContracts;
