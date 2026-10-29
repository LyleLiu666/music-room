const esc=(v:string)=>v.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export function welcomeMarkup(){
 return `<section class="empty-sound welcome"><span>♫</span><h2>从一个声音开始。</h2><p>选一种创作方式，填写内容，试听后把满意的版本选为成品。</p><div class="welcome-options">${[['music','创作音乐','歌曲、纯音乐'],['speech','创作语音','旁白、朗读'],['clip','创作片段','短旋律、间奏'],['conversion','转换音色','上传音频，替换人声']].map(([kind,title,hint])=>`<button class="secondary" data-action="quick-start" data-kind="${kind}"><strong>${title}</strong><small>${hint}</small></button>`).join('')}</div><p class="field-note">生成的版本自动保存，原版保留。未提交的输入是浏览器草稿。</p><button class="quiet" data-action="new-project">只创建项目</button></section>`;
}
export function backupGuide(workspace:string,mcp:unknown){
 const config=mcp as {mcpServers?:Record<string,{command:string;args:string[]}>};
 const server=config?.mcpServers?.['music-room'];
 const quote=(s:string)=>"'"+s.replace(/'/g,"'\\''")+"'";
 const args=server?.args??[];const index=args.lastIndexOf('mcp');
 const executable=server&&index>=0?[server.command,...args.slice(0,index)].map(quote).join(' '):'music-room';
 const backup=workspace+'-backup-'+new Date().toISOString().replace(/[:.]/g,'-');const restored=workspace+'-restored';
 const commands=[`${executable} stop --workspace ${quote(workspace)}`,`${executable} backup --workspace ${quote(workspace)} --destination ${quote(backup)}`,`${executable} verify-backup --backup ${quote(backup)}`,`${executable} start --workspace ${quote(workspace)}`].join('\n');
 const restore=`${executable} restore-backup --backup ${quote(backup)} --destination ${quote(restored)}\n${executable} start --workspace ${quote(restored)}`;
 return `<p>备份整个工作目录，包括作品、版本、音频、回收站与目录内的模型。外部模型目录不包含在内。</p><p><strong>先等待任务结束，再停止服务。</strong>停止后页面会断开，请先复制下面的命令到终端。每行成功后再执行下一行；备份目录必须尚不存在。</p><label for="backup-commands">停止服务 → 备份 → 完整性校验 → 重新打开</label><textarea id="backup-commands" rows="8" readonly>${esc(commands)}</textarea><details><summary>恢复到新目录</summary><p>恢复前会再次校验全部文件；不会覆盖当前作品。成功后使用新地址打开。</p><textarea rows="5" readonly aria-label="恢复命令">${esc(restore)}</textarea></details><p class="field-note">浏览器草稿不在工作目录内，备份前请提交需要保留的创作或另存文字。备份可能含私人作品和服务配置，请妥善保管；建议复制到另一块磁盘。</p>`;
}
