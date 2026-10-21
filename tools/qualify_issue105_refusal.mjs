import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
const [base,workspace,root,playwright,chrome,expected]=process.argv.slice(2);
const {chromium}=await import(pathToFileURL(playwright).href);
const browser=await chromium.launch({headless:true,executablePath:chrome});
process.once('SIGTERM',async()=>{await browser.close();process.exit(1);});
const page=await browser.newPage();page.setDefaultTimeout(12000);
const errors=[];page.on('pageerror',e=>errors.push(e.message));
try{
  await page.goto(base);
  const areas=page.getByRole('navigation',{name:'Areas'});
  await areas.getByRole('button',{name:'Data',exact:true}).click();
  if(!await page.getByLabel('Folder path').isVisible())await page.getByText('Use another folder',{exact:true}).click();
  await page.getByLabel('Folder path').fill(workspace);
  await page.getByRole('button',{name:'Open workspace',exact:true}).click();
  await areas.getByRole('button',{name:'Saved',exact:true}).click();
  const response=page.waitForResponse(r=>r.url().endsWith('/api/investigations/reopen'));
  await page.getByRole('button',{name:'Reopen Issue 105 F10',exact:true}).click();
  const reply=await response;assert.equal(reply.status(),expected==='healthy'?200:409);
  const refusal=await reply.json();
  if(expected==='healthy'){
    await areas.getByRole('button',{name:'Purchasing analysis',exact:true}).click();
    await page.getByRole('table',{name:'Purchasing flow at PO-item grain',exact:true}).waitFor();
    for(const [kind,label] of [['json','Export saved definitions, results and witnesses'],['md','Export readable purchasing analysis report']]){
      const pending=page.waitForEvent('download');await page.getByRole('button',{name:label,exact:true}).click();
      const download=await pending;const raw=await readFile(await download.path());
      assert.deepEqual(raw,await readFile(root+'/presentation.'+kind));
      await writeFile(root+'/reopened.'+kind,raw);
    }
  }else{
    assert.equal(refusal.code,expected);
    await page.getByRole('alert').filter({hasText:refusal.message}).waitFor();
  }
  assert.deepEqual(errors,[]);
  await writeFile(root+'/'+expected+'-browser.json',JSON.stringify({success:true,refusal,errors}));
}finally{await browser.close();}
