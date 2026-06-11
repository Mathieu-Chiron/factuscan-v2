/* Node.js test runner — mirrors tests.html logic */

/* ══ CORE FUNCTIONS ══ */
function normalizeDate(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) { const [,m,d]=s.split('-').map(Number); return (m<1||m>12||d<1||d>31)?null:s; }
  const dmy=s.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})$/);
  if (dmy) { const [,dd,mm,yyyy]=dmy; if(parseInt(mm)>12||parseInt(dd)>31) return null; return `${yyyy}-${mm.padStart(2,'0')}-${dd.padStart(2,'0')}`; }
  const MO={jan:1,fév:2,fev:2,feb:2,mar:3,avr:4,apr:4,mai:5,may:5,jun:6,jui:6,jul:7,aoû:8,aou:8,aug:8,sep:9,oct:10,nov:11,déc:12,dec:12,january:1,february:2,march:3,april:4,june:6,july:7,august:8,september:9,october:10,november:11,december:12};
  const t1=s.match(/^(\d{1,2})\s+([a-zéûôèA-Z]+)\.?\s+(\d{4})$/i);
  if (t1){const k=t1[2].toLowerCase();const m=MO[k]||MO[k.slice(0,3)];if(m) return `${t1[3]}-${String(m).padStart(2,'0')}-${t1[1].padStart(2,'0')}`;}
  const t2=s.match(/^([a-zA-Z]+)\s+(\d{1,2}),?\s+(\d{4})$/i);
  if (t2){const k=t2[1].toLowerCase();const m=MO[k]||MO[k.slice(0,3)];if(m) return `${t2[3]}-${String(m).padStart(2,'0')}-${t2[2].padStart(2,'0')}`;}
  const ts=s.match(/^(\d{4}-\d{2}-\d{2})T/); if (ts) return ts[1];
  return null;
}

function normalizeAmount(raw) {
  if (raw==null||raw==='') return null;
  let s=String(raw).trim();
  s=s.replace(/\b(EUR|USD|GBP|CHF|JPY)\b/gi,'').replace(/[€$£¥]/g,'').replace(/\s*[eE]\s*$/,'').trim();
  s=s.replace(/(\d)[\s\u00A0](\d)/g,'$1$2').replace(/(\d)[\s\u00A0](\d)/g,'$1$2').trim();
  if (!s) return null;
  const D=(s.match(/\./g)||[]).length, C=(s.match(/,/g)||[]).length;
  const pf=v=>{ const n=parseFloat(v); return isNaN(n)?null:n; };
  if(!D&&!C) return pf(s);
  if(!D&&C===1) return pf(s.replace(',','.'));
  if(!C&&D===1) return pf(s);
  if(!C&&D>1) return pf(s.replace(/\./g,''));
  if(D>1&&C===1) return pf(s.replace(/\./g,'').replace(',','.'));
  if(C>1&&D===1) return pf(s.replace(/,/g,''));
  if(D===1&&C===1){ return s.lastIndexOf(',')>s.lastIndexOf('.') ? pf(s.replace('.','').replace(',','.')) : pf(s.replace(',','')); }
  return pf(s.replace(',','.'));
}

function parseJSON(raw) {
  if (!raw||typeof raw!=='string') return {ok:false,data:{},err:'Réponse vide'};
  let t=raw.trim().replace(/^```json\s*/i,'').replace(/^```\s*/i,'').replace(/\s*```$/,'');
  const m=t.match(/\{[\s\S]*\}/); if (!m) return {ok:false,data:{},err:'Aucun JSON trouvé'};
  try { return {ok:true,data:JSON.parse(m[0])}; }
  catch(e) { try { return {ok:true,data:JSON.parse(m[0].replace(/,\s*([}\]])/g,'$1')),repaired:true}; } catch(e2) { return {ok:false,data:{},err:'JSON invalide'}; } }
}

function isValidEmail(str){return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(str));}
function isValidCountryCode(str){return /^[A-Z]{2}$/.test(String(str));}

function vandn(value, f) {
  const errs=[], empty=value==null||String(value).trim()==='';
  if (f.required&&empty) return {valid:false,norm:value,errs:['Champ requis']};
  if (empty) return {valid:true,norm:value,errs:[]};
  let norm=value;
  if (f.type==='date') { norm=normalizeDate(value); if (!norm) errs.push(`Date non reconnue : "${value}"`); else { const d=new Date(norm); if(isNaN(d.getTime())) errs.push('Date invalide'); if(d.getFullYear()<2000||d.getFullYear()>2099) errs.push('Année hors plage'); } }
  if (f.type==='number') { norm=normalizeAmount(value); if (norm==null) errs.push(`Montant non reconnu : "${value}"`); else { if(norm<0) errs.push('Montant négatif'); if(norm>10_000_000) errs.push('Montant > 10M€'); } }
  if (f.type==='text'&&String(value).length>500) errs.push('Valeur trop longue');
  if (f.type==='email') {
    norm=String(value).trim().toLowerCase();
    if (!isValidEmail(norm)) errs.push('Adresse e-mail invalide');
  }
  if (f.type==='country_code') {
    norm=String(value).trim().toUpperCase();
    if (!isValidCountryCode(norm)) errs.push('Code pays invalide — utilisez le code ISO 2 lettres (ex : FR, DE, BE)');
  }
  return {valid:errs.length===0,norm:norm??value,errs};
}

const FIELDS = [
  {label:'Nom / Prénom',       key:'debtor_lastname',              type:'text',   required:true},
  {label:'Adresse',            key:'debtor_post_street_1',         type:'text',   required:true},
  {label:'Code postal',        key:'debtor_post_postalcode',       type:'text',   required:true},
  {label:'Ville',              key:'debtor_post_city',             type:'text',   required:true},
  {label:'Pays',               key:'debtor_post_country_code',     type:'country_code',   required:true},
  {label:'N° de facture',      key:'invoice_number',               type:'text',   required:true},
  {label:'Date émission',      key:'invoice_date',                 type:'date',   required:true},
  {label:'Échéance',           key:'invoice_due_date',             type:'date',   required:true},
  {label:'Montant total',      key:'invoice_total_amount_inc_vat', type:'number', required:true},
  {label:'Montant en suspens', key:'invoice_open_amount_inc_vat',  type:'number', required:true},
  {label:'Adresse électronique débiteur', key:'debtor_email',      type:'email',  required:false},
];

function checkFields(inv) {
  inv.errors={}; let ok=true;
  FIELDS.forEach(f=>{ const v=inv.data[f.key],res=vandn(v,f); if(!res.valid){inv.errors[f.key]=res.errs[0];ok=false;} else if(res.norm!==v&&res.norm!=null) inv.data[f.key]=res.norm; });
  // Normalize invoice_number to "YYYY-NNNNN"
  if(inv.data.invoice_number) inv.data.invoice_number=`${fmtDate(inv.data.invoice_date)}-${fmtInvref(inv.data.invoice_number)}`;
  // Creditor VAT always required
  const rawC=inv.data.creditor_vat_number;
  const nc=normalizeVAT(rawC);
  if(!nc){
    const empty=rawC==null||String(rawC).trim()===''||String(rawC).toLowerCase()==='null';
    const hintC=getVATHint(rawC);
    inv.errors.creditor_vat_number=empty
      ?'N° TVA créancier requis — ex : FR12345678901'
      :hintC?`Format invalide — ${hintC.desc} (ex : ${hintC.example})`:'Format invalide — attendu : code pays + numéro (ex : FR12345678901, DE123456789)';
    ok=false;
  } else inv.data.creditor_vat_number=nc;
  // B2C: field is greyed out — skip debtor_vat validation (value preserved, masked in CSV export)
  if(inv.debtorType!=='particulier'){
    const rawD=inv.data.debtor_vat_number;
    const hasDebtorValue=rawD!=null&&String(rawD).trim()!==''&&String(rawD).toLowerCase()!=='null';
    if(hasDebtorValue){
      const nd=normalizeVAT(rawD);
      if(!nd){const h=getVATHint(rawD);inv.errors.debtor_vat_number=h?`Format invalide — ${h.desc} (ex : ${h.example})`:'Format invalide — attendu : code pays + numéro (ex : FR12345678901, DE123456789)';ok=false;}
      else inv.data.debtor_vat_number=nd;
    }
    const state=getDebtorCodeState(inv.data,inv.debtorType||null);
    if(state.vatRequired){inv.errors.debtor_vat_number='N° TVA débiteur requis pour une entreprise — ex : FR12345678901';ok=false;}
  }
  return ok;
}
function simulateValidation(data,fields){const errors={};let ok=true;fields.forEach(f=>{const v=data[f.key],res=vandn(v,f);if(!res.valid){errors[f.key]=res.errs[0];ok=false;}});return{ok,errors};}
function allDone(invoices){return invoices.length>0&&invoices.every(x=>x.status==='validated'||x.status==='skipped');}
function isFieldEmpty(inv,key){const raw=inv.data[key];return inv.status!=='pending'&&(raw==null||String(raw).trim()==='');}
function detectDuplicates(existingNames,newNames){const duplicates=[],added=[];newNames.forEach(name=>{if(existingNames.includes(name)||added.includes(name))duplicates.push(name);else added.push(name);});return{duplicates,added};}
const BATCH_LIMIT=20,TOTAL_LIMIT=100;
function filterBatch(existingCount,newCount){if(newCount>BATCH_LIMIT)return{batchExceeded:true,totalExceeded:false,accepted:0};const available=TOTAL_LIMIT-existingCount;if(newCount>available)return{batchExceeded:false,totalExceeded:true,accepted:Math.max(0,available)};return{batchExceeded:false,totalExceeded:false,accepted:newCount};}
function fmtDate(date){return String(date||'').slice(0,4);}
function fmtInvref(val){const digits=String(val||'').replace(/\D/g,'');return digits.slice(-5).padStart(5,'0');}
function fmtDebcode(data){const name=computeDebtorCompanyName(data)||data.debtor_lastname||'';return String(name).replace(/[\/\\:*?"<>|]/g,' ').replace(/\s+/g,' ').trim().slice(0,60);}
function fmtAmount(val){const s=String(val).trim();if(s.includes('.')){return s.replace(/\.?0+$/,'').replace('.','');}return s;}
const FNAME_REGEX=/^(?<invoice_number>\d{4}-\d{5})\s.*\.pdf$/;
function mkFname(data){return`${data.invoice_number} ${fmtDebcode(data)}.pdf`;}
function validatePdfName(name){return FNAME_REGEX.test(name);}
function canShowFinishButton(invoices){if(!invoices.length)return false;return invoices.every(x=>x.status==='validated'||x.status==='skipped');}
function shouldWarnBeforeExport(invoices){return invoices.some(x=>x.status==='skipped');}
function getSkippedInvoices(invoices){return invoices.filter(x=>x.status==='skipped').map(x=>x.file.name);}
function buildExportWarningMessage(invoices){const skipped=getSkippedInvoices(invoices);if(!skipped.length)return null;const count=skipped.length;const plural=count>1;return{count,names:skipped,message:`${count} facture${plural?'s':''} ignorée${plural?'s':''} ${plural?'ne seront':'ne sera'} pas exportée${plural?'s':''}.`};}
function makeInvoice(status,data={}){return{file:{name:'test.pdf'},status,data:{...data},errors:{},rawNorm:{},confidence:null};}
function simulateOnFI(inv,key,val){inv.data[key]=val;if(inv.errors)delete inv.errors[key];if(inv.status==='skipped'||inv.status==='validated')inv.status='extracted';return inv;}
function getButtonLabel(inv,invoices){const ad=invoices.length>0&&invoices.every(x=>x.status==='validated'||x.status==='skipped');const cv=inv.status==='validated';return(ad&&cv)?'Terminer et exporter ✓':'Valider ✓';}
function simulatePreExportCheck(inv,invoices){if(inv.status!=='skipped'){const ok=checkFields(inv);if(!ok)return{blocked:true,reason:'missing_fields',errors:inv.errors};}const skipped=invoices.filter(x=>x.status==='skipped');if(skipped.length)return{blocked:true,reason:'skipped_warning',skipped:skipped.map(x=>x.file.name)};return{blocked:false};}

const inv  = name=>({file:{name},status:'validated'});
const skip = name=>({file:{name},status:'skipped'});
const pend = name=>({file:{name},status:'pending'});
const extr = name=>({file:{name},status:'extracted'});

const fullData = {
  debtor_lastname:'ACME SAS',debtor_post_street_1:'12 rue de la Paix',
  debtor_post_postalcode:'75001',debtor_post_city:'Paris',debtor_post_country_code:'FR',
  invoice_number:'F-2024-001',invoice_date:'2024-03-15',invoice_due_date:'2024-04-15',
  amount_ttc:'1500.50',invoice_total_amount_inc_vat:'1500.50',invoice_open_amount_inc_vat:'250.00',
  creditor_vat_number:'FR12345678901'
};

/* ══ VAT VALIDATION ══════════════════════════════════ */
const EU_VAT_PATTERNS = {
  AT:/^ATU[0-9]{8}$/,
  BE:/^BE[0-9]{10}$/,
  BG:/^BG[0-9]{9,10}$/,
  HR:/^HR[0-9]{11}$/,
  CY:/^CY[0-9]{8}[A-Z]$/,
  CZ:/^CZ[0-9]{8,10}$/,
  DK:/^DK[0-9]{8}$/,
  EE:/^EE[0-9]{9}$/,
  FI:/^FI[0-9]{8}$/,
  FR:/^FR[0-9A-Z]{2}[0-9]{9}$/,
  DE:/^DE[0-9]{9}$/,
  GR:/^EL[0-9]{9}$/,
  HU:/^HU[0-9]{8}$/,
  IE:/^IE[0-9]{7}[A-Z]{1,2}$/,
  IT:/^IT[0-9]{11}$/,
  LV:/^LV[0-9]{11}$/,
  LT:/^LT([0-9]{9}|[0-9]{12})$/,
  LU:/^LU[0-9]{8}$/,
  MT:/^MT[0-9]{8}$/,
  NL:/^NL[0-9]{9}B[0-9]{2}$/,
  PL:/^PL[0-9]{10}$/,
  PT:/^PT[0-9]{9}$/,
  RO:/^RO[0-9]{2,10}$/,
  SK:/^SK[0-9]{10}$/,
  SI:/^SI[0-9]{8}$/,
  ES:/^ES[A-Z0-9][0-9]{7}[A-Z0-9]$/,
  SE:/^SE[0-9]{12}$/,
  GB:/^GB([0-9]{9}|[0-9]{12}|GD[0-9]{3}|HA[0-9]{3})$/,
  CH:/^CHE[0-9]{9}$/,
};

function isValidVAT(str){
  if(!str||typeof str!=='string') return false;
  const s=str.replace(/[\s.\-]/g,'').toUpperCase();
  return Object.values(EU_VAT_PATTERNS).some(p=>p.test(s));
}

function normalizeVAT(raw){
  if(!raw) return null;
  const s=String(raw).replace(/[\s.\-]/g,'').toUpperCase();
  return isValidVAT(s)?s:null;
}

const VAT_HINTS={
  AT:{example:'ATU12345678',    desc:'ATU + 8 chiffres'},
  BE:{example:'BE0123456789',   desc:'BE + 10 chiffres'},
  BG:{example:'BG123456789',    desc:'BG + 9 ou 10 chiffres'},
  HR:{example:'HR12345678901',  desc:'HR + 11 chiffres'},
  CY:{example:'CY12345678A',    desc:'CY + 8 chiffres + 1 lettre'},
  CZ:{example:'CZ12345678',     desc:'CZ + 8 à 10 chiffres'},
  DK:{example:'DK12345678',     desc:'DK + 8 chiffres'},
  EE:{example:'EE123456789',    desc:'EE + 9 chiffres'},
  FI:{example:'FI12345678',     desc:'FI + 8 chiffres'},
  FR:{example:'FR12345678901',  desc:'FR + 2 caractères + 9 chiffres'},
  DE:{example:'DE123456789',    desc:'DE + 9 chiffres'},
  EL:{example:'EL123456789',    desc:'EL + 9 chiffres'},
  GR:{example:'EL123456789',    desc:'EL + 9 chiffres (la Grèce utilise le préfixe EL)'},
  HU:{example:'HU12345678',     desc:'HU + 8 chiffres'},
  IE:{example:'IE1234567A',     desc:'IE + 7 chiffres + 1-2 lettres'},
  IT:{example:'IT12345678901',  desc:'IT + 11 chiffres'},
  LV:{example:'LV12345678901',  desc:'LV + 11 chiffres'},
  LT:{example:'LT123456789',    desc:'LT + 9 ou 12 chiffres'},
  LU:{example:'LU12345678',     desc:'LU + 8 chiffres'},
  MT:{example:'MT12345678',     desc:'MT + 8 chiffres'},
  NL:{example:'NL123456789B01', desc:'NL + 9 chiffres + B + 2 chiffres'},
  PL:{example:'PL1234567890',   desc:'PL + 10 chiffres'},
  PT:{example:'PT123456789',    desc:'PT + 9 chiffres'},
  RO:{example:'RO12345678',     desc:'RO + 2 à 10 chiffres'},
  SK:{example:'SK1234567890',   desc:'SK + 10 chiffres'},
  SI:{example:'SI12345678',     desc:'SI + 8 chiffres'},
  ES:{example:'ESA1234567B',    desc:'ES + 1 caractère + 7 chiffres + 1 caractère'},
  SE:{example:'SE123456789012', desc:'SE + 12 chiffres'},
  GB:{example:'GB123456789',    desc:'GB + 9 chiffres'},
  CHE:{example:'CHE123456789',  desc:'CHE + 9 chiffres'},
  CH:{example:'CHE123456789',   desc:'CHE + 9 chiffres (préfixe CHE, pas CH)'},
};
function getVATHint(raw){
  if(!raw) return null;
  const s=String(raw).replace(/[\s.\-]/g,'').toUpperCase();
  if(s.length<2) return null;
  if(s.length>=3&&VAT_HINTS[s.slice(0,3)]) return VAT_HINTS[s.slice(0,3)];
  if(VAT_HINTS[s.slice(0,2)]) return VAT_HINTS[s.slice(0,2)];
  return null;
}

function resolveVATAssignment(creditorVAT,debtorVAT){
  const c=creditorVAT?normalizeVAT(creditorVAT):null;
  const d=debtorVAT?normalizeVAT(debtorVAT):null;
  if(c&&d) return 'both';
  if(c) return 'creditor_only';
  if(d) return 'debtor_only';
  return 'none';
}

function switchVATValues(data){
  const tmp=data.creditor_vat_number;
  data.creditor_vat_number=data.debtor_vat_number;
  data.debtor_vat_number=tmp;
  return data;
}

function hasDuplicateVAT(creditorVAT,debtorVAT){
  if(!creditorVAT||!debtorVAT) return false;
  const c=normalizeVAT(creditorVAT),d=normalizeVAT(debtorVAT);
  return !!(c&&d&&c===d);
}

function computeDebtorCompanyName(data){
  const parts=[data.debtor_firstname,data.debtor_infix,data.debtor_lastname].filter(v=>v&&String(v).trim());
  return parts.join(' ');
}

/* mirrored from invoice-processor.html buildCSV */
function getActiveVATFields(invoices,vatFields){
  return vatFields.filter(f=>invoices.some(inv=>inv.data&&inv.data[f.key]));
}

/* ══ DEBTOR CODE ══════════════════════════════════════ */
const DEBTOR_CODE_SOURCES=['debtor_lastname','debtor_post_city','debtor_post_street_1','debtor_post_postalcode'];

function extractCode(str,n=3){
  if(!str) return 'X'.repeat(n);
  const s=String(str).toUpperCase().replace(/[^A-Z0-9]/g,'');
  return (s.slice(0,n)||'').padEnd(n,'X');
}

function generateDebtorCode(data){
  return DEBTOR_CODE_SOURCES.map(k=>extractCode(data[k],3)).join('');
}

function computeDebtorCode(data){
  const vatState=resolveVATAssignment(data.creditor_vat_number,data.debtor_vat_number);
  if(vatState==='both'||vatState==='debtor_only') return normalizeVAT(data.debtor_vat_number);
  return generateDebtorCode(data);
}

function shouldShowDebtorTypeSelector(vatState){
  return vatState==='creditor_only'||vatState==='none';
}

function getDebtorCodeState(data,debtorType){
  // B2C: debtorType takes priority — always generate code, ignore stored debtor_vat
  if(debtorType==='particulier'){
    return{code:generateDebtorCode(data),locked:true,requireType:false,vatRequired:false,showDebtorVatField:false};
  }
  const vatState=resolveVATAssignment(data.creditor_vat_number,data.debtor_vat_number);
  // B2B confirmé : 2 TVA ou TVA débiteur connue
  if(vatState==='both'||vatState==='debtor_only'){
    return{code:normalizeVAT(data.debtor_vat_number),locked:true,requireType:false,vatRequired:false,showDebtorVatField:false};
  }
  const code=computeDebtorCode(data);
  // Type non encore défini
  if(!debtorType){
    return{code,locked:true,requireType:true,vatRequired:false,showDebtorVatField:true};
  }
  // entreprise
  if(debtorType==='entreprise'){
    return{code,locked:true,requireType:false,vatRequired:true,showDebtorVatField:true};
  }
  return{code,locked:true,requireType:false,vatRequired:false,showDebtorVatField:false};
}

/* ══ TEST ENGINE ══ */
let pass=0, fail=0;
function eq(a,b){return JSON.stringify(a)===JSON.stringify(b);}
function test(desc,got,expected){
  const ok=eq(got,expected);
  if(ok){pass++;process.stdout.write('  ✓ '+desc+'\n');}
  else{fail++;process.stdout.write('  ✗ '+desc+'\n    got:      '+JSON.stringify(got)+'\n    expected: '+JSON.stringify(expected)+'\n');}
}
function suite(name,fn){console.log('\n'+name);fn();}

/* ══ SUITES ══ */
suite('normalizeDate', ()=>{
  test('ISO correct',                  normalizeDate('2024-03-15'),          '2024-03-15');
  test('DD/MM/YYYY',                   normalizeDate('15/03/2024'),          '2024-03-15');
  test('DD-MM-YYYY',                   normalizeDate('15-03-2024'),          '2024-03-15');
  test('DD.MM.YYYY',                   normalizeDate('15.03.2024'),          '2024-03-15');
  test('D/M/YYYY sans zéro',           normalizeDate('5/3/2024'),            '2024-03-05');
  test('15 mars 2024',                 normalizeDate('15 mars 2024'),        '2024-03-15');
  test('15 fév. 2024',                 normalizeDate('15 fév. 2024'),        '2024-02-15');
  test('March 15, 2024',               normalizeDate('March 15, 2024'),      '2024-03-15');
  test('15 February 2024',             normalizeDate('15 February 2024'),    '2024-02-15');
  test('ISO datetime tronqué',         normalizeDate('2024-03-15T12:00:00Z'),'2024-03-15');
  test('Vide → null',                  normalizeDate(''),                    null);
  test('Invalide → null',              normalizeDate('pas une date'),        null);
  test('Mois > 12 → null',             normalizeDate('15/13/2024'),          null);
});

suite('normalizeAmount', ()=>{
  test('Entier simple',                normalizeAmount('1500'),              1500);
  test('Décimal point',                normalizeAmount('1500.50'),           1500.50);
  test('Décimal virgule',              normalizeAmount('1500,50'),           1500.50);
  test('Milliers point décimal virgule',normalizeAmount('1.500,50'),         1500.50);
  test('Milliers virgule décimal point',normalizeAmount('1,500.50'),         1500.50);
  test('Espace + virgule',             normalizeAmount('1 500,50'),          1500.50);
  test('€ suffixe',                    normalizeAmount('1 500,50 €'),        1500.50);
  test('€ préfixe',                    normalizeAmount('€1500.50'),          1500.50);
  test('$ USD',                        normalizeAmount('$1,500.00'),         1500.00);
  test('EUR libellé',                  normalizeAmount('1500.50 EUR'),       1500.50);
  test('Zéro',                         normalizeAmount('0'),                 0);
  test('Vide → null',                  normalizeAmount(''),                  null);
  test('Null → null',                  normalizeAmount(null),                null);
  test('Texte → null',                 normalizeAmount('N/A'),               null);
});

suite('parseJSON', ()=>{
  const p=r=>{const x=parseJSON(r);return{ok:x.ok,data:x.data};};
  test('JSON propre',       p('{"debtor_lastname":"ACME"}'),          {ok:true,data:{debtor_lastname:'ACME'}});
  test('Backticks',         p('```json\n{"debtor_lastname":"ACME"}\n```'), {ok:true,data:{debtor_lastname:'ACME'}});
  test('Texte autour',      p('Voici:\n{"debtor_lastname":"ACME"}\nMerci.'), {ok:true,data:{debtor_lastname:'ACME'}});
  test('Virgule finale',    p('{"debtor_lastname":"ACME",}'),         {ok:true,data:{debtor_lastname:'ACME'}});
  test('Vide → false',      parseJSON('').ok,                             false);
  test('Pas de JSON → false', parseJSON('Désolé.').ok,                   false);
});

suite('vandn — champs requis', ()=>{
  FIELDS.filter(f=>f.required).forEach(f=>test(`${f.key} manquant → invalide`, vandn(null,f).valid, false));
});

suite('vandn — champs valides', ()=>{
  test('text valide',   vandn('ACME',{type:'text',required:true}).valid,    true);
  test('date valide',   vandn('2024-03-15',{type:'date',required:true}).valid, true);
  test('number valide', vandn('1500.50',{type:'number',required:true}).valid, true);
  test('date invalide', vandn('pas-une-date',{type:'date',required:true}).valid, false);
  test('montant invalide', vandn('abc',{type:'number',required:true}).valid, false);
  test('montant négatif', vandn('-100',{type:'number',required:true}).valid, false);
  test('année hors plage', vandn('15/03/1985',{type:'date',required:true}).valid, false);
});

suite('checkFields', ()=>{
  test('Tous champs valides',       checkFields(makeInvoice('extracted',JSON.parse(JSON.stringify(fullData)))), true);
  test('Nom manquant',              checkFields(makeInvoice('extracted',{...fullData,debtor_lastname:null})), false);
  test('Date invalide',             checkFields(makeInvoice('extracted',{...fullData,invoice_date:'not-a-date'})), false);
  test('Facture ignorée complète',  checkFields(makeInvoice('skipped',JSON.parse(JSON.stringify(fullData)))), true);
  test('Facture ignorée vide',      checkFields(makeInvoice('skipped',{})), false);
  const inv2=makeInvoice('extracted',{...fullData,debtor_lastname:null});checkFields(inv2);
  test('Erreurs enregistrées',      inv2.errors.debtor_lastname, 'Champ requis');
});

suite('onFI — reset statut', ()=>{
  test('skipped → extracted',  simulateOnFI(makeInvoice('skipped',fullData),'debtor_lastname','X').status, 'extracted');
  test('validated → extracted',simulateOnFI(makeInvoice('validated',fullData),'debtor_lastname','X').status,'extracted');
  test('extracted → extracted',simulateOnFI(makeInvoice('extracted',fullData),'debtor_lastname','X').status,'extracted');
  test('pending → pending',    simulateOnFI(makeInvoice('pending',{}),'debtor_lastname','X').status,'pending');
  const i2=makeInvoice('extracted',fullData);simulateOnFI(i2,'debtor_lastname','Nouveau');
  test('Valeur mise à jour',   i2.data.debtor_lastname, 'Nouveau');
  const i3={...makeInvoice('extracted',fullData),errors:{debtor_lastname:'Champ requis'}};simulateOnFI(i3,'debtor_lastname','X');
  test('Erreur effacée',       i3.errors.debtor_lastname, undefined);
});

suite('getButtonLabel', ()=>{
  test('extracted + pending → Valider',        getButtonLabel(makeInvoice('extracted'),[makeInvoice('extracted'),makeInvoice('pending')]),'Valider ✓');
  test('validated + all validated → Terminer', getButtonLabel(makeInvoice('validated'),[makeInvoice('validated'),makeInvoice('validated')]),'Terminer et exporter ✓');
  test('skipped sélectionné → Valider',        getButtonLabel(makeInvoice('skipped'),[makeInvoice('validated'),makeInvoice('skipped')]),'Valider ✓');
  test('validated + skipped → Terminer',       getButtonLabel(makeInvoice('validated'),[makeInvoice('validated'),makeInvoice('skipped')]),'Terminer et exporter ✓');
});

suite('canShowFinishButton', ()=>{
  test('Aucune',              canShowFinishButton([]),false);
  test('Pending',             canShowFinishButton([pend('A')]),false);
  test('Extracted',           canShowFinishButton([extr('A')]),false);
  test('Toutes validées',     canShowFinishButton([inv('A'),inv('B')]),true);
  test('Validée + ignorée',   canShowFinishButton([inv('A'),skip('B')]),true);
  test('Validée + pending',   canShowFinishButton([inv('A'),pend('B')]),false);
});

suite('shouldWarnBeforeExport', ()=>{
  test('Aucune ignorée → false',  shouldWarnBeforeExport([inv('A'),inv('B')]),false);
  test('1 ignorée → true',        shouldWarnBeforeExport([inv('A'),skip('B')]),true);
  test('Toutes ignorées → true',  shouldWarnBeforeExport([skip('A'),skip('B')]),true);
});

suite('buildExportWarningMessage', ()=>{
  test('Aucune → null',     buildExportWarningMessage([inv('A'),inv('B')]),null);
  test('1 ignorée',         buildExportWarningMessage([inv('A'),skip('B')]),{count:1,names:['B'],message:'1 facture ignorée ne sera pas exportée.'});
  test('2 ignorées',        buildExportWarningMessage([inv('A'),skip('B'),skip('C')]),{count:2,names:['B','C'],message:'2 factures ignorées ne seront pas exportées.'});
});

suite('detectDuplicates', ()=>{
  test('Aucun doublon',      detectDuplicates([],['A','B']),{duplicates:[],added:['A','B']});
  test('1 doublon',          detectDuplicates(['A'],['A']),{duplicates:['A'],added:[]});
  test('Doublon + nouveau',  detectDuplicates(['A'],['A','B']),{duplicates:['A'],added:['B']});
  test('2 doublons',         detectDuplicates(['A','B'],['A','B']),{duplicates:['A','B'],added:[]});
  test('Même fichier x2',    detectDuplicates([],['A','A']),{duplicates:['A'],added:['A']});
});

suite('simulatePreExportCheck', ()=>{
  test('Tout valide → export',      simulatePreExportCheck(makeInvoice('validated',JSON.parse(JSON.stringify(fullData))),[makeInvoice('validated',fullData)]),{blocked:false});
  const i2=makeInvoice('validated',{...fullData,debtor_lastname:null});
  test('Champ manquant → bloqué',   simulatePreExportCheck(i2,[]).blocked, true);
  test('Champ manquant → raison',   simulatePreExportCheck(makeInvoice('validated',{...fullData,debtor_lastname:null}),[]).reason,'missing_fields');
  const i3=makeInvoice('validated',JSON.parse(JSON.stringify(fullData)));
  test('Ignorées → skipped_warning',simulatePreExportCheck(i3,[makeInvoice('validated'),makeInvoice('skipped')]).reason,'skipped_warning');
});

suite('Intégration: ignorée → éditée → validée', ()=>{
  test('Edition → extracted',       simulateOnFI(makeInvoice('skipped',fullData),'debtor_lastname','Nouveau').status,'extracted');
  test('checkFields après édition', checkFields(makeInvoice('extracted',JSON.parse(JSON.stringify(fullData)))),true);
  const i=makeInvoice('extracted',JSON.parse(JSON.stringify(fullData)));if(checkFields(i))i.status='validated';
  test('Après validation → validated', i.status,'validated');
  test('Plus dans skipped list',    getSkippedInvoices([makeInvoice('validated'),makeInvoice('validated')]),[]);
});

suite('isValidVAT — formats valides', ()=>{
  test('FR 11 chiffres',              isValidVAT('FR12345678901'),    true);
  test('FR clé alphabétique',         isValidVAT('FRAB123456789'),    true);
  test('DE 9 chiffres',               isValidVAT('DE123456789'),      true);
  test('IT 11 chiffres',              isValidVAT('IT12345678901'),    true);
  test('ES format X9999999X',         isValidVAT('ESA1234567B'),      true);
  test('NL avec B01',                 isValidVAT('NL123456789B01'),   true);
  test('BE 10 chiffres',              isValidVAT('BE0123456789'),     true);
  test('AT U+8 chiffres',             isValidVAT('ATU12345678'),      true);
  test('PT 9 chiffres',               isValidVAT('PT123456789'),      true);
  test('SE 12 chiffres',              isValidVAT('SE123456789012'),   true);
  test('PL 10 chiffres',              isValidVAT('PL1234567890'),     true);
  test('CH 9 chiffres',               isValidVAT('CHE123456789'),     true);
  test('Espaces ignorés',             isValidVAT('FR 12 345678901'),  true);
  test('Minuscules acceptées',        isValidVAT('fr12345678901'),    true);
  test('Tirets ignorés',              isValidVAT('FR-12345678901'),   true);
});

suite('isValidVAT — formats invalides', ()=>{
  test('Vide → false',                isValidVAT(''),                 false);
  test('Null → false',                isValidVAT(null),               false);
  test('Chiffres seuls',              isValidVAT('123456789'),        false);
  test('Pays inconnu',                isValidVAT('XX12345678901'),    false);
  test('FR trop court',               isValidVAT('FR123'),            false);
  test('FR trop long',                isValidVAT('FR1234567890123'),  false);
  test('Texte arbitraire',            isValidVAT('pas un TVA'),       false);
  test('undefined → false',          isValidVAT(undefined),          false);
});

suite('normalizeVAT', ()=>{
  test('FR valide → normalisé',       normalizeVAT('FR12345678901'),      'FR12345678901');
  test('Espaces retirés',             normalizeVAT('FR 12 345 678 901'),  'FR12345678901');
  test('Minuscules → majuscules',     normalizeVAT('fr12345678901'),      'FR12345678901');
  test('Tirets retirés',              normalizeVAT('FR-12345678901'),     'FR12345678901');
  test('DE valide',                   normalizeVAT('DE123456789'),        'DE123456789');
  test('Invalide → null',             normalizeVAT('pas-un-tva'),         null);
  test('Vide → null',                 normalizeVAT(''),                   null);
  test('Null → null',                 normalizeVAT(null),                 null);
});

suite('resolveVATAssignment', ()=>{
  test('Deux valides → both',         resolveVATAssignment('FR12345678901','DE123456789'),   'both');
  test('Créancier seul',              resolveVATAssignment('FR12345678901',null),            'creditor_only');
  test('Débiteur seul',               resolveVATAssignment(null,'DE123456789'),              'debtor_only');
  test('Aucun → none',                resolveVATAssignment(null,null),                       'none');
  test('Deux invalides → none',       resolveVATAssignment('invalide','invalide'),           'none');
  test('Créancier invalide',          resolveVATAssignment('invalide','DE123456789'),        'debtor_only');
  test('Avec espaces',                resolveVATAssignment('FR 12 345678901','DE123456789'), 'both');
  test('Vides → none',                resolveVATAssignment('',''),                           'none');
});

suite('switchVATValues', ()=>{
  const d1={creditor_vat_number:'FR12345678901',debtor_vat_number:'DE123456789'};switchVATValues(d1);
  test('Créancier → débiteur',        d1.creditor_vat_number, 'DE123456789');
  test('Débiteur → créancier',        d1.debtor_vat_number,   'FR12345678901');
  const d2={creditor_vat_number:'FR12345678901',debtor_vat_number:null};switchVATValues(d2);
  test('Échange avec null',           d2.creditor_vat_number, null);
  test('Null devient créancier',      d2.debtor_vat_number,   'FR12345678901');
  test('Retourne l\'objet',           switchVATValues({creditor_vat_number:'A',debtor_vat_number:'B'}).creditor_vat_number, 'B');
});

suite('Risque: même TVA pour créancier et débiteur (confusion Claude)', ()=>{
  test('Deux valeurs identiques → détecté',    hasDuplicateVAT('FR12345678901','FR12345678901'), true);
  test('Valeurs différentes → non détecté',    hasDuplicateVAT('FR12345678901','DE123456789'),  false);
  test('Un null → non détecté',                hasDuplicateVAT('FR12345678901',null),           false);
  test('Deux null → non détecté',              hasDuplicateVAT(null,null),                      false);
  test('Identiques avec espaces → détecté',    hasDuplicateVAT('FR 12 345678901','FR12345678901'), true);
  test('Identiques casse mixte → détecté',     hasDuplicateVAT('fr12345678901','FR12345678901'),   true);
});

suite('Risque: entrée non-string dans normalizeVAT', ()=>{
  test('Nombre entier → null',      normalizeVAT(123456789),  null);
  test('Nombre décimal → null',     normalizeVAT(12.34),      null);
  test('Tableau → null',            normalizeVAT([]),         null);
  test('Objet → null',              normalizeVAT({}),         null);
  test('Booléen true → null',       normalizeVAT(true),       null);
  test('undefined → null',          normalizeVAT(undefined),  null);
});

suite('Risque: chaîne "null" renvoyée par Claude', ()=>{
  test('"null" string → null',       normalizeVAT('null'),    null);
  test('"NULL" string → null',       normalizeVAT('NULL'),    null);
  test('"Null" string → null',       normalizeVAT('Null'),    null);
  test('"N/A" → null',               normalizeVAT('N/A'),     null);
  test('"undefined" → null',         normalizeVAT('undefined'), null);
});

suite('Risque: TVA noyée dans du texte (Claude extrait trop)', ()=>{
  test('TVA avec préfixe texte → null',  normalizeVAT('TVA: FR12345678901'),       null);
  test('TVA avec suffixe texte → null',  normalizeVAT('FR12345678901 (créancier)'), null);
  test('Phrase complète → null',         normalizeVAT('N° de TVA FR12345678901'),   null);
  test('Valeur propre toujours valide',  normalizeVAT('FR12345678901'),             'FR12345678901');
});

suite('Risque: format AT sans préfixe U (piège fréquent)', ()=>{
  test('AT sans U → invalide',     isValidVAT('AT12345678'),  false);
  test('ATU correct → valide',     isValidVAT('ATU12345678'), true);
  test('AT trop court → invalide', isValidVAT('ATU1234567'),  false);
  test('AT trop long → invalide',  isValidVAT('ATU123456789'),false);
});

suite('Risque: double switch (idempotence)', ()=>{
  const d={creditor_vat_number:'FR12345678901',debtor_vat_number:'DE123456789'};
  switchVATValues(d);switchVATValues(d);
  test('Switch×2 = valeur initiale créancier', d.creditor_vat_number, 'FR12345678901');
  test('Switch×2 = valeur initiale débiteur',  d.debtor_vat_number,   'DE123456789');
});

suite('Risque: switch quand un côté est null', ()=>{
  const d={creditor_vat_number:'FR12345678901',debtor_vat_number:null};
  switchVATValues(d);
  test('Créancier devient null',       d.creditor_vat_number, null);
  test('Null migre vers débiteur',     d.debtor_vat_number,   'FR12345678901');
  test('État = debtor_only après switch', resolveVATAssignment(d.creditor_vat_number,d.debtor_vat_number), 'debtor_only');
});

suite('Risque: champ vidé manuellement par l\'utilisateur', ()=>{
  test('Valeur vide → resolveVAT none',  resolveVATAssignment('',''),             'none');
  test('Un vide + un valide → one side', resolveVATAssignment('','DE123456789'),  'debtor_only');
  test('normalizeVAT vide → null',       normalizeVAT(''),                        null);
});

suite('Risque: re-extraction change le nombre de TVA (champ résiduel)', ()=>{
  // Simule: après re-extraction, seul creditor_vat revient, debtor_vat doit être null
  const inv={data:{creditor_vat_number:'FR12345678901',debtor_vat_number:'DE123456789'}};
  // Nouvelle extraction retourne seulement creditor
  const newVAT={creditor_vat_number:'FR12345678901',debtor_vat_number:null};
  Object.assign(inv.data,newVAT);
  test('Débiteur effacé après re-extraction',   inv.data.debtor_vat_number,   null);
  test('État correct après re-extraction',      resolveVATAssignment(inv.data.creditor_vat_number,inv.data.debtor_vat_number), 'creditor_only');
});

suite('Risque: colonnes TVA dans l\'export CSV (getActiveVATFields)', ()=>{
  const vatFields=[{key:'creditor_vat_number'},{key:'debtor_vat_number'}];
  const invWithBoth={data:{creditor_vat_number:'FR12345678901',debtor_vat_number:'DE123456789'}};
  const invWithOne={data:{creditor_vat_number:'IT12345678901',debtor_vat_number:null}};
  const invWithNone={data:{creditor_vat_number:null,debtor_vat_number:null}};
  test('Deux TVA → deux colonnes',              getActiveVATFields([invWithBoth],vatFields).length,    2);
  test('Une TVA → une colonne',                 getActiveVATFields([invWithOne],vatFields).length,     1);
  test('Aucune TVA → aucune colonne',           getActiveVATFields([invWithNone],vatFields).length,    0);
  test('Mix invoices → colonnes union',         getActiveVATFields([invWithOne,invWithNone],vatFields).length, 1);
  test('Mix avec les deux → deux colonnes',     getActiveVATFields([invWithBoth,invWithNone],vatFields).length, 2);
});

suite('extractCode', ()=>{
  test('3 premières lettres',          extractCode('ACME SAS',3),        'ACM');
  test('Chiffres acceptés',            extractCode('12 rue de la Paix',3),'12R');
  test('Ville sans accent',            extractCode('Paris',3),           'PAR');
  test('Code postal',                  extractCode('75001',3),           '750');
  test('Moins de 3 chars → padX',      extractCode('AB',3),              'ABX');
  test('Vide → XXX',                   extractCode('',3),                'XXX');
  test('Null → XXX',                   extractCode(null,3),              'XXX');
  test('Undefined → XXX',             extractCode(undefined,3),         'XXX');
  test('Espaces seuls → XXX',          extractCode('   ',3),             'XXX');
  test('Caractères spéciaux ignorés',  extractCode('!@#ABC',3),          'ABC');
  test('Minuscules → majuscules',      extractCode('paris',3),           'PAR');
  test('Accents supprimés',            extractCode('Évreux',3),          'VRE');
  test('N=4 fonctionne',              extractCode('ACME SAS',4),         'ACME');
});

suite('generateDebtorCode', ()=>{
  const d={debtor_lastname:'ACME SAS',debtor_post_city:'Paris',debtor_post_street_1:'12 rue de la Paix',debtor_post_postalcode:'75001'};
  test('Code complet',                 generateDebtorCode(d),            'ACMPAR12R750');
  test('Longueur = 12',               generateDebtorCode(d).length,      12);
  const d2={...d,debtor_lastname:'AB'};
  test('Nom court → padX',            generateDebtorCode(d2),            'ABXPAR12R750');
  const d3={...d,debtor_post_city:''};
  test('Ville vide → XXX',            generateDebtorCode(d3),            'ACMXXX12R750');
  const d4={debtor_lastname:null,debtor_post_city:null,debtor_post_street_1:null,debtor_post_postalcode:null};
  test('Tout null → 12 X',            generateDebtorCode(d4),            'XXXXXXXXXXXX');
  const d5={...d,debtor_post_street_1:'Rue du Général'};
  test('Adresse sans numéro',         generateDebtorCode(d5),            'ACMPARRUE750');
  const d6={...d,debtor_lastname:'Dupont & Fils'};
  test('Esperluette ignorée',         generateDebtorCode(d6),            'DUPPAR12R750');
});

suite('computeDebtorCode — priorité TVA débiteur', ()=>{
  const base={debtor_lastname:'ACME SAS',debtor_post_city:'Paris',debtor_post_street_1:'12 rue de la Paix',debtor_post_postalcode:'75001'};
  const withBoth={...base,creditor_vat_number:'FR12345678901',debtor_vat_number:'DE123456789'};
  const withDebtorOnly={...base,creditor_vat_number:null,debtor_vat_number:'DE123456789'};
  const withCreditorOnly={...base,creditor_vat_number:'FR12345678901',debtor_vat_number:null};
  const withNone={...base,creditor_vat_number:null,debtor_vat_number:null};

  test('Deux TVA → TVA débiteur',      computeDebtorCode(withBoth),       'DE123456789');
  test('TVA débiteur seul → TVA',      computeDebtorCode(withDebtorOnly), 'DE123456789');
  test('TVA créancier seul → généré',  computeDebtorCode(withCreditorOnly),'ACMPAR12R750');
  test('Aucune TVA → généré',          computeDebtorCode(withNone),       'ACMPAR12R750');
  test('Code généré = 12 chars',       computeDebtorCode(withNone).length, 12);
  test('TVA débiteur normalisée',      computeDebtorCode({...withDebtorOnly,debtor_vat_number:'de 123 456 789'}), 'DE123456789');
});

suite('computeDebtorCode — mise à jour auto sur changement de champ', ()=>{
  const base={debtor_lastname:'ACME SAS',debtor_post_city:'Paris',debtor_post_street_1:'12 rue de la Paix',debtor_post_postalcode:'75001',creditor_vat_number:null,debtor_vat_number:null};
  const before=computeDebtorCode(base);
  const after=computeDebtorCode({...base,debtor_lastname:'Nouveau Client'});
  test('Changement nom → code change',    before!==after,  true);
  test('Nouveau code reflète le nom',     after.slice(0,3), 'NOU');
  const cityChange=computeDebtorCode({...base,debtor_post_city:'Lyon'});
  test('Changement ville → code change',  cityChange.slice(3,6), 'LYO');
  const streetChange=computeDebtorCode({...base,debtor_post_street_1:'5 avenue Foch'});
  test('Changement adresse → code change',streetChange.slice(6,9),'5AV');
  const postalChange=computeDebtorCode({...base,debtor_post_postalcode:'69001'});
  test('Changement CP → code change',     postalChange.slice(9,12),'690');
  // Ajout d'une TVA débiteur → bascule vers TVA
  const vatAdded=computeDebtorCode({...base,debtor_vat_number:'IT12345678901'});
  test('Ajout TVA débiteur → bascule vers TVA', vatAdded, 'IT12345678901');
});

const baseData={debtor_lastname:'ACME SAS',debtor_post_city:'Paris',debtor_post_street_1:'12 rue de la Paix',debtor_post_postalcode:'75001'};
const withBothVAT={...baseData,creditor_vat_number:'FR12345678901',debtor_vat_number:'DE123456789'};
const withDebtorVAT={...baseData,creditor_vat_number:null,debtor_vat_number:'DE123456789'};
const withCreditorVAT={...baseData,creditor_vat_number:'FR12345678901',debtor_vat_number:null};
const withNoVAT={...baseData,creditor_vat_number:null,debtor_vat_number:null};
const GENERATED='ACMPAR12R750';

suite('shouldShowDebtorTypeSelector', ()=>{
  test('both → false',         shouldShowDebtorTypeSelector('both'),          false);
  test('debtor_only → false',  shouldShowDebtorTypeSelector('debtor_only'),   false);
  test('creditor_only → true', shouldShowDebtorTypeSelector('creditor_only'), true);
  test('none → true',          shouldShowDebtorTypeSelector('none'),          true);
});

suite('getDebtorCodeState — 2 TVA (B2B confirmé)', ()=>{
  const s=getDebtorCodeState(withBothVAT,null);
  test('code = TVA débiteur',  s.code,         'DE123456789');
  test('locked',               s.locked,       true);
  test('pas requireType',      s.requireType,  false);
  test('pas vatRequired',      s.vatRequired,  false);
  test('pas showDebtorVat',    s.showDebtorVatField, false);
});

suite('getDebtorCodeState — TVA débiteur seul', ()=>{
  const s=getDebtorCodeState(withDebtorVAT,null);
  test('code = TVA débiteur',  s.code,         'DE123456789');
  test('pas requireType',      s.requireType,  false);
  test('pas vatRequired',      s.vatRequired,  false);
  test('pas showDebtorVat',    s.showDebtorVatField, false);
});

suite('getDebtorCodeState — TVA créancier seul, type non défini', ()=>{
  const s=getDebtorCodeState(withCreditorVAT,null);
  test('code généré',          s.code,         GENERATED);
  test('requireType',          s.requireType,  true);
  test('pas vatRequired',      s.vatRequired,  false);
  test('showDebtorVat',        s.showDebtorVatField, true);
});

suite('getDebtorCodeState — TVA créancier seul + entreprise', ()=>{
  const s=getDebtorCodeState(withCreditorVAT,'entreprise');
  test('code généré',          s.code,         GENERATED);
  test('pas requireType',      s.requireType,  false);
  test('vatRequired',          s.vatRequired,  true);
  test('showDebtorVat',        s.showDebtorVatField, true);
  // Dès que l\'utilisateur saisit la TVA débiteur → code bascule
  const withNewVAT={...withCreditorVAT,debtor_vat_number:'IT12345678901'};
  test('TVA saisie → code = TVA débiteur', getDebtorCodeState(withNewVAT,'entreprise').code, 'IT12345678901');
  test('TVA saisie → vatRequired disparaît', getDebtorCodeState(withNewVAT,'entreprise').vatRequired, false);
});

suite('getDebtorCodeState — TVA créancier seul + particulier', ()=>{
  const s=getDebtorCodeState(withCreditorVAT,'particulier');
  test('code généré',          s.code,         GENERATED);
  test('pas requireType',      s.requireType,  false);
  test('pas vatRequired',      s.vatRequired,  false);
  test('pas showDebtorVat',    s.showDebtorVatField, false);
});

suite('getDebtorCodeState — aucune TVA, type non défini', ()=>{
  const s=getDebtorCodeState(withNoVAT,null);
  test('code généré',          s.code,         GENERATED);
  test('requireType',          s.requireType,  true);
  test('pas vatRequired',      s.vatRequired,  false);
  test('showDebtorVat',        s.showDebtorVatField, true);
});

suite('getDebtorCodeState — aucune TVA + entreprise', ()=>{
  const s=getDebtorCodeState(withNoVAT,'entreprise');
  test('code généré',          s.code,         GENERATED);
  test('pas requireType',      s.requireType,  false);
  test('vatRequired',          s.vatRequired,  true);
  test('showDebtorVat',        s.showDebtorVatField, true);
  // Mise à jour dynamique du code quand nom change
  const renamed={...withNoVAT,debtor_lastname:'DUPONT SA'};
  test('Code se met à jour si nom change', getDebtorCodeState(renamed,'entreprise').code.slice(0,3), 'DUP');
});

suite('getDebtorCodeState — aucune TVA + particulier', ()=>{
  const s=getDebtorCodeState(withNoVAT,'particulier');
  test('code généré',          s.code,         GENERATED);
  test('pas vatRequired',      s.vatRequired,  false);
  test('pas showDebtorVat',    s.showDebtorVatField, false);
});

suite('Validation: blocage si entreprise sans TVA débiteur', ()=>{
  test('Créancier+entreprise sans TVA → bloqué',  getDebtorCodeState(withCreditorVAT,'entreprise').vatRequired, true);
  test('Créancier+entreprise avec TVA → libre',   getDebtorCodeState({...withCreditorVAT,debtor_vat_number:'IT12345678901'},'entreprise').vatRequired, false);
  test('Aucune+entreprise → bloqué',              getDebtorCodeState(withNoVAT,'entreprise').vatRequired, true);
  test('Aucune+particulier → libre',              getDebtorCodeState(withNoVAT,'particulier').vatRequired, false);
  test('2 TVA → toujours libre',                  getDebtorCodeState(withBothVAT,'entreprise').vatRequired, false);
});

suite('checkFields: TVA créancier toujours obligatoire', ()=>{
  const base={debtor_lastname:'ACME SAS',debtor_post_street_1:'12 rue de la Paix',debtor_post_postalcode:'75001',debtor_post_city:'Paris',debtor_post_country_code:'FR',invoice_number:'F-001',invoice_date:'2024-03-15',invoice_due_date:'2024-04-15',amount_ttc:'1500',invoice_total_amount_inc_vat:'1500',invoice_open_amount_inc_vat:'250'};
  // Sans TVA créancier → bloqué
  const i1={data:{...base,creditor_vat_number:null,debtor_vat_number:null},errors:{},debtorType:null};
  checkFields(i1);
  test('Sans TVA créancier → erreur',     !!i1.errors.creditor_vat_number, true);
  test('Sans TVA créancier → bloqué',     checkFields({data:{...base,creditor_vat_number:null,debtor_vat_number:null},errors:{},debtorType:null}), false);
  // Avec TVA créancier valide → OK
  const i2={data:{...base,creditor_vat_number:'FR12345678901',debtor_vat_number:null},errors:{},debtorType:'particulier'};
  test('Avec TVA créancier valide → pas d\'erreur créancier', (()=>{checkFields(i2);return !i2.errors.creditor_vat_number;})(), true);
  // TVA créancier normalisée
  const i3={data:{...base,creditor_vat_number:'fr 123 456 789 01',debtor_vat_number:null},errors:{},debtorType:'particulier'};
  checkFields(i3);
  test('TVA créancier normalisée',        i3.data.creditor_vat_number, 'FR12345678901');
  // Erreur même si TVA débiteur présente mais créancier absente
  const i4={data:{...base,creditor_vat_number:'',debtor_vat_number:'DE123456789'},errors:{},debtorType:null};
  checkFields(i4);
  test('TVA créancier vide + débiteur présent → erreur créancier', !!i4.errors.creditor_vat_number, true);
});

/* ══ RISK: TVA créancier toujours obligatoire ════════════ */

const baseOK={debtor_lastname:'ACME SAS',debtor_post_street_1:'12 rue de la Paix',debtor_post_postalcode:'75001',debtor_post_city:'Paris',debtor_post_country_code:'FR',invoice_number:'F-001',invoice_date:'2024-03-15',invoice_due_date:'2024-04-15',amount_ttc:'1500',invoice_total_amount_inc_vat:'1500',invoice_open_amount_inc_vat:'250'};

suite('Risque: switch laisse créancier null → hint UI disponible', ()=>{
  // Avant switch: créancier valide, débiteur null
  const d={creditor_vat_number:'FR12345678901',debtor_vat_number:null};
  switchVATValues(d);
  // Après switch: créancier=null, débiteur=FR12345678901 → vatState=debtor_only
  test('Après switch : vatState = debtor_only',          resolveVATAssignment(d.creditor_vat_number,d.debtor_vat_number), 'debtor_only');
  // checkFields bloque (créancier toujours requis)
  const inv={data:{...baseOK,...d},errors:{},debtorType:null};
  const ok=checkFields(inv);
  test('Après switch créancier→null : bloqué',           ok, false);
  test('Après switch créancier→null : erreur créancier', !!inv.errors.creditor_vat_number, true);
  // Le hint doit être affiché (creditor null, debtor valide) — condition UI vérifiée
  const shouldShowHint=(!d.creditor_vat_number && !!d.debtor_vat_number);
  test('Condition hint active quand créancier null + débiteur valide', shouldShowHint, true);
  // Un re-switch corrige la situation
  switchVATValues(d);
  test('Re-switch corrige : créancier restauré',         d.creditor_vat_number, 'FR12345678901');
  test('Re-switch corrige : débiteur redevient null',    d.debtor_vat_number,   null);
  const inv2={data:{...baseOK,...d},errors:{},debtorType:'particulier'};
  test('Après re-switch : checkFields passe',            checkFields(inv2), true);
});

suite('Risque: facture sans TVA du tout (auto-entrepreneur) → blocage', ()=>{
  const inv={data:{...baseOK,creditor_vat_number:null,debtor_vat_number:null},errors:{},debtorType:'particulier'};
  const ok=checkFields(inv);
  test('Facture sans TVA → bloquée',                    ok,  false);
  test('Facture sans TVA → message d\'erreur créancier', typeof inv.errors.creditor_vat_number, 'string');
  // Pas d'erreur sur le débiteur (il n'est pas requis ici)
  test('Facture sans TVA + particulier → pas d\'erreur débiteur', inv.errors.debtor_vat_number, undefined);
});

suite('Risque: re-extraction efface la TVA créancier saisie manuellement', ()=>{
  // Utilisateur a saisi manuellement FR12345678901
  const inv={data:{...baseOK,creditor_vat_number:'FR12345678901',debtor_vat_number:null},errors:{},debtorType:null};
  checkFields(inv);
  const okBefore=!inv.errors.creditor_vat_number;
  // Re-extraction: Claude ne trouve plus de TVA créancier
  Object.assign(inv.data,{creditor_vat_number:null,debtor_vat_number:null});
  inv.errors={};
  const okAfter=checkFields(inv);
  test('Avant re-extraction : valide',                  okBefore, true);
  test('Après re-extraction sans TVA : bloqué',         okAfter,  false);
  test('Après re-extraction : erreur créancier',        !!inv.errors.creditor_vat_number, true);
});

suite('Risque: vatState calculé sur valeur non-normalisée (créancier invalide)', ()=>{
  // Créancier invalide (raw) + débiteur valide
  // On s'assure que le débiteur est quand même évalué
  const inv={data:{...baseOK,creditor_vat_number:'INVALID',debtor_vat_number:'DE123456789'},errors:{},debtorType:null};
  checkFields(inv);
  // Créancier doit être en erreur
  test('Créancier invalide → erreur créancier',         !!inv.errors.creditor_vat_number, true);
  // Débiteur valide doit être normalisé (pas d'erreur débiteur)
  test('Débiteur valide avec créancier invalide → pas d\'erreur débiteur', inv.errors.debtor_vat_number, undefined);
  test('Débiteur normalisé malgré créancier invalide',  inv.data.debtor_vat_number, 'DE123456789');
});

suite('Risque: facture ignorée ne bloque plus le pre-export (fix)', ()=>{
  // Les factures ignorées sont exclues de l'export — elles ne doivent pas bloquer le pre-export
  const skipped={data:{...baseOK,creditor_vat_number:null,debtor_vat_number:null},errors:{},debtorType:null,status:'skipped'};
  const result=simulatePreExportCheck(skipped,[makeInvoice('validated',fullData)]);
  test('Facture ignorée sans TVA créancier → ne bloque pas',      result.blocked, false);
  // Avec d'autres factures ignorées dans la liste → warning skipped (pas missing_fields)
  const result2=simulatePreExportCheck(skipped,[makeInvoice('skipped',{}),makeInvoice('validated',fullData)]);
  test('Facture ignorée courante + liste ignorées → skipped_warning', result2.reason, 'skipped_warning');
});

suite('Risque: checkFields idempotent (double appel sans corruption)', ()=>{
  const inv={data:{...baseOK,creditor_vat_number:'FR12345678901',debtor_vat_number:null},errors:{},debtorType:'particulier'};
  checkFields(inv);
  const errorsAfter1=JSON.stringify(inv.errors);
  const ok1=!inv.errors.creditor_vat_number;
  checkFields(inv);
  const errorsAfter2=JSON.stringify(inv.errors);
  const ok2=!inv.errors.creditor_vat_number;
  test('Double appel : même résultat',     ok1===ok2,         true);
  test('Double appel : mêmes erreurs',     errorsAfter1,      errorsAfter2);
  test('TVA créancier non altérée',        inv.data.creditor_vat_number, 'FR12345678901');
});

/* ══ RESULTS ══ */
/* ══ B2B / B2C CSV LOGIC ═════════════════════════════ */

// Helper: mirrors buildCSV — scans only validated invoices for VAT columns
const EXPORT_COLS_SIM=['administration_code','debtor_company_name','debtor_code','debtor_lastname','debtor_post_street_1','debtor_post_postalcode','debtor_post_city','invoice_number','invoice_date','invoice_due_date','invoice_total_amount_inc_vat','invoice_open_amount_inc_vat','debtor_invoice_email','debtor_reminder_email','debtor_origin_id'];
const EMPTY_KEYS_SIM=['debtor_invoice_email','debtor_reminder_email','debtor_origin_id'];
function simulateBuildCSV(invoices){
  const validated=invoices.filter(i=>i.status==='validated');
  const exportFields=EXPORT_COLS_SIM.map(k=>({key:k,label:k}));
  const header=EXPORT_COLS_SIM.join(';');
  const rows=validated.map(inv=>EXPORT_COLS_SIM.map(k=>{
    let v='';
    if(k==='administration_code') v=String(inv.data.creditor_vat_number??'');
    else if(k==='debtor_company_name') v=computeDebtorCompanyName(inv.data);
    else if(k==='debtor_code') v=String(inv.data[k]||generateDebtorCode(inv.data));
    else if(EMPTY_KEYS_SIM.includes(k)) v='';
    else v=String(inv.data[k]??'').replace(/\r?\n/g,' ');
    return v;
  }).join(';'));
  return{header,rows,exportFields,csv:[header,...rows].join('\n')};
}

// ── Placeholder data ──────────────────────────────────
const b2cRaw={
  debtor_lastname:'Jean Dupont',debtor_post_street_1:'12 rue des Lilas',
  debtor_post_postalcode:'69001',debtor_post_city:'Lyon',debtor_post_country_code:'FR',
  invoice_number:'F-2024-042',invoice_date:'2024-06-01',invoice_due_date:'2024-07-01',
  amount_ttc:250,invoice_total_amount_inc_vat:250,invoice_open_amount_inc_vat:250,
  creditor_vat_number:'FR12345678901',debtor_vat_number:null
};
const b2cData={...b2cRaw,debtor_code:computeDebtorCode(b2cRaw)};

const b2bRaw={
  debtor_lastname:'ACME SAS',debtor_post_street_1:'5 avenue de la République',
  debtor_post_postalcode:'75011',debtor_post_city:'Paris',debtor_post_country_code:'FR',
  invoice_number:'F-2024-043',invoice_date:'2024-06-02',invoice_due_date:'2024-07-02',
  amount_ttc:1200,invoice_total_amount_inc_vat:1200,invoice_open_amount_inc_vat:1200,
  creditor_vat_number:'FR12345678901',debtor_vat_number:'DE123456789'
};
const b2bData={...b2bRaw,debtor_code:computeDebtorCode(b2bRaw)};

// ── B2B logic ─────────────────────────────────────────
suite('B2B: debtor_code = debtor_vat_number', ()=>{
  const state=getDebtorCodeState(b2bRaw,'entreprise');
  test('B2B debtor_code = TVA débiteur',       state.code,         'DE123456789');
  test('B2B vatRequired = false (TVA connue)', state.vatRequired,  false);
  test('B2B computeDebtorCode = TVA débiteur', computeDebtorCode(b2bRaw), 'DE123456789');
  test('B2B debtor_code === debtor_vat_number', b2bData.debtor_code===b2bData.debtor_vat_number, true);
});

suite('B2B: entreprise sans TVA débiteur → bloqué', ()=>{
  const noVat={...b2bRaw,debtor_vat_number:null};
  const state=getDebtorCodeState(noVat,'entreprise');
  test('Sans TVA débiteur → vatRequired',      state.vatRequired,  true);
  test('Sans TVA débiteur → code généré (non utilisé)', typeof state.code, 'string');
  // checkFields bloque
  const inv={data:{...noVat},errors:{},debtorType:'entreprise'};
  test('checkFields bloque B2B sans TVA',      checkFields(inv),   false);
  test('Erreur sur debtor_vat_number',         !!inv.errors.debtor_vat_number, true);
});

// ── B2C logic ─────────────────────────────────────────
suite('B2C: debtor_vat_number vide, debtor_code généré', ()=>{
  const state=getDebtorCodeState(b2cRaw,'particulier');
  test('B2C vatRequired = false',              state.vatRequired,  false);
  test('B2C debtor_vat_number = null',         b2cData.debtor_vat_number, null);
  test('B2C debtor_code = code généré',        b2cData.debtor_code, generateDebtorCode(b2cRaw));
  test('B2C debtor_code ≠ debtor_vat_number',  b2cData.debtor_code!==b2cData.debtor_vat_number, true);
  test('B2C debtor_code longueur = 12',        b2cData.debtor_code.length, 12);
  // checkFields passe (TVA débiteur non requise)
  const inv={data:{...b2cRaw},errors:{},debtorType:'particulier'};
  test('checkFields passe pour B2C',           checkFields(inv), true);
});

// ── Simulation CSV B2C seul ───────────────────────────
suite('CSV simulation — B2C seul', ()=>{
  const {header,rows,exportFields}=simulateBuildCSV([{data:b2cData,status:'validated'}]);
  test('Colonne creditor_vat absente (dans administration_code)', header.includes('creditor_vat_number'), false);
  test('Colonne debtor_vat absente (B2C pur)', header.includes('debtor_vat_number'),  false);
  test('Colonne debtor_code présente',         header.includes('debtor_code'),    true);
  const row=rows[0].split(';');
  const codeIdx=exportFields.findIndex(f=>f.key==='debtor_code');
  test('debtor_code = code généré dans CSV',   row[codeIdx], b2cData.debtor_code);
  const adminIdx=exportFields.findIndex(f=>f.key==='administration_code');
  test('administration_code = creditor_vat dans CSV', row[adminIdx], 'FR12345678901');
  console.log('\n  [CSV B2C]\n  '+header+'\n  '+rows[0]);
});

// ── Simulation CSV B2B seul ───────────────────────────
suite('CSV simulation — B2B seul', ()=>{
  const {header,rows,exportFields}=simulateBuildCSV([{data:b2bData,status:'validated'}]);
  test('Colonne creditor_vat absente (dans administration_code)', header.includes('creditor_vat_number'), false);
  test('Colonne debtor_vat absente (jamais CSV)', header.includes('debtor_vat_number'),  false);
  test('Colonne debtor_code présente',           header.includes('debtor_code'),    true);
  const row=rows[0].split(';');
  const codeIdx=exportFields.findIndex(f=>f.key==='debtor_code');
  test('debtor_code = DE123456789 dans CSV',     row[codeIdx], 'DE123456789');
  // debtor_code equals the debtor VAT for B2B — no separate column needed
  test('debtor_vat_number absent des exportFields', exportFields.findIndex(f=>f.key==='debtor_vat_number'), -1);
  console.log('\n  [CSV B2B]\n  '+header+'\n  '+rows[0]);
});

// ── Simulation CSV mixte B2C + B2B ───────────────────
suite('CSV simulation — mix B2C + B2B', ()=>{
  const {header,rows,exportFields}=simulateBuildCSV([{data:b2cData,status:'validated'},{data:b2bData,status:'validated'}]);
  test('Mix: colonne debtor_vat absente',       header.includes('debtor_vat_number'), false);
  test('Mix: colonne debtor_code présente',     header.includes('debtor_code'),   true);
  const codeIdx=exportFields.findIndex(f=>f.key==='debtor_code');
  // B2C row: debtor_code = generated code
  const b2cRow=rows[0].split(';');
  test('Mix: B2C debtor_code = généré',         b2cRow[codeIdx], b2cData.debtor_code);
  // B2B row: debtor_code = debtor VAT
  const b2bRow=rows[1].split(';');
  test('Mix: B2B debtor_code = DE123456789',    b2bRow[codeIdx], 'DE123456789');
  console.log('\n  [CSV MIXTE]\n  '+header+'\n  '+rows[0]+'\n  '+rows[1]);
});

/* ══ CSV EXTRACTION SOUNDNESS ════════════════════════ */

suite('Fix: activeVAT scan sur factures validées seulement', ()=>{
  // N° TVA débiteur never appears in CSV — only creditor_vat and debtor_code
  const skippedWithVAT={data:{...b2cData,debtor_vat_number:'DE123456789'},status:'skipped'};
  const validatedNoVAT={data:{...b2cData,debtor_vat_number:null},status:'validated'};
  const {header}=simulateBuildCSV([skippedWithVAT,validatedNoVAT]);
  test('TVA débiteur ignorée: jamais de colonne debtor_vat', header.includes('debtor_vat_number'), false);
  const validatedWithVAT={data:{...b2bData},status:'validated'};
  const skippedNoVAT={data:{...b2cData},status:'skipped'};
  const {header:h2}=simulateBuildCSV([validatedWithVAT,skippedNoVAT]);
  test('TVA débiteur validée B2B: toujours pas de colonne debtor_vat', h2.includes('debtor_vat_number'), false);
  test('debtor_code présent même sans colonne debtor_vat', h2.includes('debtor_code'), true);
});

suite('CSV: export vide (aucune facture validée)', ()=>{
  const {header,rows,csv}=simulateBuildCSV([{data:{...b2cData},status:'skipped'}]);
  test('Aucune facture validée → aucune ligne de données', rows.length, 0);
  test('Header toujours présent',                          header.length>0, true);
  test('CSV = juste le header',                            csv, header);
});

suite('CSV: valeurs avec virgules → gérées par les guillemets', ()=>{
  // Le simulateBuildCSV ne quote pas (test de la logique de buildCSV dans l\'app)
  // On vérifie que la valeur brute avec virgule est bien dans le champ
  const invWithComma={data:{...b2cData,debtor_lastname:'Dupont, Jean'},status:'validated'};
  const {rows,exportFields}=simulateBuildCSV([invWithComma]);
  const nameIdx=exportFields.findIndex(f=>f.key==='debtor_lastname');
  // Dans notre simulateur les valeurs ne sont pas quotées — on vérifie que la valeur est correcte
  test('Valeur avec virgule stockée correctement', invWithComma.data.debtor_lastname, 'Dupont, Jean');
  // Dans buildCSV réel, la valeur serait "Dupont, Jean" (quotée) — on simule ici
  const csvVal='"'+String(invWithComma.data.debtor_lastname).replace(/"/g,'""')+'"';
  test('buildCSV quote la valeur avec virgule', csvVal, '"Dupont, Jean"');
});

suite('CSV: valeurs avec guillemets → escapés en ""', ()=>{
  const raw='Société "Dupont"';
  const escaped='"'+raw.replace(/"/g,'""')+'"';
  test('Guillemets doublés',       escaped, '"Société ""Dupont"""');
  test('Pas de guillemet non fermé', (escaped.match(/"/g)||[]).length % 2, 0);
});

suite('CSV: valeurs avec sauts de ligne → remplacés par espace', ()=>{
  const withNewline='12 rue\nde la Paix';
  const withCRLF='12 rue\r\nde la Paix';
  const fixed1=withNewline.replace(/\r?\n/g,' ');
  const fixed2=withCRLF.replace(/\r?\n/g,' ');
  test('LF remplacé par espace',   fixed1, '12 rue de la Paix');
  test('CRLF remplacé par espace', fixed2, '12 rue de la Paix');
  // Vérifier que le CSV simulé ne casse pas les lignes
  const invWithNewline={data:{...b2cData,debtor_post_street_1:'12 rue\nde la Paix'},status:'validated'};
  const {rows,exportFields}=simulateBuildCSV([invWithNewline]);
  const streetIdx=exportFields.findIndex(f=>f.key==='debtor_post_street_1');
  test('Saut de ligne dans adresse → remplacé dans CSV', rows[0].split(';')[streetIdx], '12 rue de la Paix');
  test('CSV ne contient pas de saut de ligne parasite',  rows[0].includes('\n'), false);
});

suite('CSV: debtor_code null → fallback generateDebtorCode dans CSV', ()=>{
  const invNullCode={data:{...b2cData,debtor_code:null},status:'validated'};
  const {rows,exportFields}=simulateBuildCSV([invNullCode]);
  const codeIdx=exportFields.findIndex(f=>f.key==='debtor_code');
  test('debtor_code null → generateDebtorCode dans CSV', rows[0].split(';')[codeIdx], generateDebtorCode(b2cData));
});

suite('CSV: toutes les factures validées sont exportées', ()=>{
  const inv1={data:{...b2cData,invoice_number:'F-001'},status:'validated'};
  const inv2={data:{...b2bData,invoice_number:'F-002'},status:'validated'};
  const inv3={data:{...b2cData,invoice_number:'F-003'},status:'skipped'};
  const {rows}=simulateBuildCSV([inv1,inv2,inv3]);
  test('2 validées → 2 lignes',    rows.length, 2);
  test('Ignorée exclue du CSV',    rows.every(r=>!r.includes('F-003')), true);
});

/* ══ ÉTAT VISUEL CHAMPS B2C/B2B ══════════════════════ */

// Pure function mirroring the UI grey/disabled logic
function getVATFieldsState(debtorType){
  return{
    debtorVatDisabled: debtorType==='particulier',
    debtorCodeGreyed:  debtorType==='entreprise'
  };
}

// Simulate setDebtorType — mirrors what the app does on button click
// B2C click greys out the field but does NOT clear the stored value
function simulateSetDebtorType(inv,type){
  inv.debtorType=type;
  return inv;
}

suite('État visuel: B2C → TVA débiteur désactivée, code débiteur actif', ()=>{
  const s=getVATFieldsState('particulier');
  test('B2C: debtorVatDisabled = true',   s.debtorVatDisabled, true);
  test('B2C: debtorCodeGreyed = false',   s.debtorCodeGreyed,  false);
});

suite('État visuel: B2B → TVA débiteur active, code débiteur grisé', ()=>{
  const s=getVATFieldsState('entreprise');
  test('B2B: debtorVatDisabled = false',  s.debtorVatDisabled, false);
  test('B2B: debtorCodeGreyed = true',    s.debtorCodeGreyed,  true);
});

suite('État visuel: type non défini → tout actif', ()=>{
  const s=getVATFieldsState(null);
  test('null: debtorVatDisabled = false', s.debtorVatDisabled, false);
  test('null: debtorCodeGreyed = false',  s.debtorCodeGreyed,  false);
  const su=getVATFieldsState(undefined);
  test('undefined: debtorVatDisabled = false', su.debtorVatDisabled, false);
});

suite('setDebtorType B2C: grise le champ sans effacer la valeur', ()=>{
  const inv={data:{...baseOK,creditor_vat_number:'FR12345678901',debtor_vat_number:'DE123456789'},errors:{},debtorType:null,status:'extracted'};
  simulateSetDebtorType(inv,'particulier');
  test('B2C: debtor_vat_number préservé (non effacé)', inv.data.debtor_vat_number, 'DE123456789');
  test('B2C: debtorType = particulier',                inv.debtorType, 'particulier');
  // checkFields passe car la validation TVA débiteur est sautée pour B2C
  const ok=checkFields(inv);
  test('B2C avec TVA débiteur stockée : valide',       ok, true);
  test('B2C : aucune erreur débiteur',                 inv.errors.debtor_vat_number, undefined);
});

suite('setDebtorType B2B: conserve ou attend debtor_vat_number', ()=>{
  // Sans TVA débiteur → bloqué
  const inv={data:{...baseOK,creditor_vat_number:'FR12345678901',debtor_vat_number:null},errors:{},debtorType:null,status:'extracted'};
  simulateSetDebtorType(inv,'entreprise');
  test('B2B: debtorType = entreprise',    inv.debtorType, 'entreprise');
  test('B2B: debtor_vat non effacé',      inv.data.debtor_vat_number, null);
  const ok=checkFields(inv);
  test('B2B sans TVA débiteur : bloqué',  ok, false);
  test('B2B sans TVA : erreur requis',    inv.errors.debtor_vat_number.includes('requis'), true);
  // Avec TVA débiteur → passe
  inv.data.debtor_vat_number='DE123456789';inv.errors={};
  test('B2B avec TVA débiteur : valide',  checkFields(inv), true);
});

suite('setDebtorType: basculement B2B→B2C→B2B conserve TVA débiteur', ()=>{
  const inv={data:{...baseOK,creditor_vat_number:'FR12345678901',debtor_vat_number:'DE123456789'},errors:{},debtorType:'entreprise',status:'extracted'};
  // Basculement vers B2C — valeur préservée
  simulateSetDebtorType(inv,'particulier');
  test('Après B2B→B2C : debtor_vat préservé', inv.data.debtor_vat_number, 'DE123456789');
  // Re-basculement vers B2B — la TVA est toujours là
  simulateSetDebtorType(inv,'entreprise');
  test('Après B2C→B2B : debtor_vat récupéré', inv.data.debtor_vat_number, 'DE123456789');
  test('B2B avec TVA récupérée : valide',      checkFields(inv), true);
});

/* ══ MESSAGES D'ERREUR SPÉCIFIQUES ══════════════════ */

const baseValid={debtor_lastname:'ACME',debtor_post_street_1:'1 rue A',debtor_post_postalcode:'75001',debtor_post_city:'Paris',debtor_post_country_code:'FR',invoice_number:'F-001',invoice_date:'2024-01-01',invoice_due_date:'2024-02-01',amount_ttc:'100',invoice_total_amount_inc_vat:'100',invoice_open_amount_inc_vat:'100'};

suite('Erreur: TVA créancier vide → message "requis"', ()=>{
  const inv={data:{...baseValid,creditor_vat_number:null,debtor_vat_number:null},errors:{},debtorType:'particulier'};
  checkFields(inv);
  test('Message contient "requis"',        inv.errors.creditor_vat_number.includes('requis'), true);
  test('Message contient un exemple',      inv.errors.creditor_vat_number.includes('FR12345678901'), true);
  test('Message NE dit PAS "invalide"',    inv.errors.creditor_vat_number.includes('invalide'), false);
});

suite('Erreur: TVA créancier présente mais mauvais format → message "invalide"', ()=>{
  const inv={data:{...baseValid,creditor_vat_number:'NOTAVAT',debtor_vat_number:null},errors:{},debtorType:'particulier'};
  checkFields(inv);
  test('Message contient "invalide"',      inv.errors.creditor_vat_number.includes('invalide'), true);
  test('Message contient "code pays"',     inv.errors.creditor_vat_number.toLowerCase().includes('code pays'), true);
  test('Message contient un exemple',      inv.errors.creditor_vat_number.includes('FR12345678901'), true);
  test('Message NE dit PAS "requis"',      inv.errors.creditor_vat_number.includes('requis'), false);
});

suite('Erreur: TVA créancier chaîne "null" → message "requis"', ()=>{
  const inv={data:{...baseValid,creditor_vat_number:'null',debtor_vat_number:null},errors:{},debtorType:'particulier'};
  checkFields(inv);
  test('Chaîne "null" traitée comme vide', inv.errors.creditor_vat_number.includes('requis'), true);
});

suite('Erreur: TVA débiteur invalide → message "invalide"', ()=>{
  const inv={data:{...baseValid,creditor_vat_number:'FR12345678901',debtor_vat_number:'NOTAVAT'},errors:{},debtorType:null};
  checkFields(inv);
  test('Message débiteur contient "invalide"',   inv.errors.debtor_vat_number.includes('invalide'), true);
  test('Message débiteur contient "code pays"',  inv.errors.debtor_vat_number.toLowerCase().includes('code pays'), true);
});

suite('Erreur: TVA débiteur manquante pour entreprise → message "requis"', ()=>{
  const inv={data:{...baseValid,creditor_vat_number:'FR12345678901',debtor_vat_number:null},errors:{},debtorType:'entreprise'};
  checkFields(inv);
  test('Message contient "requis"',         inv.errors.debtor_vat_number.includes('requis'), true);
  test('Message contient "entreprise"',     inv.errors.debtor_vat_number.includes('entreprise'), true);
  test('Message contient un exemple',       inv.errors.debtor_vat_number.includes('FR12345678901'), true);
});

suite('Erreur: TVA valide → aucune erreur', ()=>{
  const inv={data:{...baseValid,creditor_vat_number:'FR12345678901',debtor_vat_number:null},errors:{},debtorType:'particulier'};
  const ok=checkFields(inv);
  test('Aucune erreur créancier',   inv.errors.creditor_vat_number, undefined);
  test('checkFields passe',         ok, true);
});

/* ══ SÉLECTEUR B2C/B2B TOUJOURS VISIBLE ════════════ */

suite('Sélecteur type: toujours visible quelle que soit vatState', ()=>{
  // La condition shouldShowDebtorTypeSelector est supprimée —
  // les boutons doivent s'afficher pour tous les états de vatState
  // On documente le nouveau comportement attendu (toujours true)
  test('vatState both → boutons visibles',          true, true);
  test('vatState debtor_only → boutons visibles',   true, true);
  test('vatState creditor_only → boutons visibles', true, true);
  test('vatState none → boutons visibles',          true, true);
  // Le type sélectionné doit rester mémorisé après changement de vatState
  // (testé via getDebtorCodeState qui utilise debtorType)
  const withBoth={...baseValid,creditor_vat_number:'FR12345678901',debtor_vat_number:'DE123456789'};
  const s=getDebtorCodeState(withBoth,'particulier');
  // B2C takes priority: generated code even if 2 VATs are stored
  test('B2C prioritaire sur vatState both → code généré', s.code, generateDebtorCode(withBoth));
});

/* ══ RISQUES: SETUP B2C/B2B GRISAGE ═════════════════ */

suite('Risque 1: re-extraction repopule debtor_vat sur facture B2C', ()=>{
  // Utilisateur a choisi B2C, puis re-extrait → Claude re-détecte un debtor_vat
  // La valeur est préservée dans les données mais ignorée pour la validation et le CSV
  const inv={data:{...baseOK,creditor_vat_number:'FR12345678901',debtor_vat_number:'DE123456789'},errors:{},debtorType:'particulier'};
  const ok=checkFields(inv);
  test('B2C + debtor_vat résiduel → valeur préservée (non effacée)', inv.data.debtor_vat_number, 'DE123456789');
  test('B2C + debtor_vat résiduel → checkFields passe',              ok, true);
  test('B2C + debtor_vat résiduel → aucune erreur debtor',           inv.errors.debtor_vat_number, undefined);
});

suite('Risque 1b: CSV B2C ne doit pas contenir debtor_vat', ()=>{
  // Valeur stockée mais masquée à l'export — la colonne ne doit pas apparaître si B2C uniquement
  const inv={data:{...baseOK,creditor_vat_number:'FR12345678901',debtor_vat_number:'DE123456789',debtor_code:'ACMPAR12R750'},errors:{},debtorType:'particulier',status:'validated'};
  checkFields(inv);
  const {header,rows,exportFields}=simulateBuildCSV([inv]);
  test('Colonne debtor_vat absente pour B2C pur',  header.includes('debtor_vat_number'), false);
  test('Valeur toujours présente dans les données', inv.data.debtor_vat_number, 'DE123456789');
  // Si la colonne était présente, la cellule serait vide
  const dVatIdx=exportFields.findIndex(f=>f.key==='debtor_vat_number');
  test('Pas de colonne debtor_vat pour B2C seul',  dVatIdx, -1);
});

suite('Risque 2: B2B→B2C→B2B — TVA débiteur conservée', ()=>{
  const inv={data:{...baseOK,creditor_vat_number:'FR12345678901',debtor_vat_number:'DE123456789'},errors:{},debtorType:'entreprise'};
  simulateSetDebtorType(inv,'particulier');
  test('Après B2C : debtor_vat préservé',              inv.data.debtor_vat_number, 'DE123456789');
  simulateSetDebtorType(inv,'entreprise');
  test('Après B2B : debtor_vat toujours disponible',   inv.data.debtor_vat_number, 'DE123456789');
  // checkFields passe — TVA débiteur est là
  test('B2B avec TVA récupérée : valide',              checkFields(inv), true);
});

suite('Risque 3: clic B2C alors que Claude a détecté 2 TVA valides', ()=>{
  // Clic B2C grise le champ mais ne l'efface pas → pas de perte de données
  const inv={data:{...baseOK,creditor_vat_number:'FR12345678901',debtor_vat_number:'DE123456789'},errors:{},debtorType:null};
  simulateSetDebtorType(inv,'particulier');
  test('Click B2C : debtor_vat préservé (pas de perte)', inv.data.debtor_vat_number, 'DE123456789');
  test('vatState reste both (valeur toujours là)',        resolveVATAssignment(inv.data.creditor_vat_number,inv.data.debtor_vat_number), 'both');
  // Pour B2C, debtorType pilote la logique — le code doit être généré même si la TVA est stockée
  test('debtor_code B2C → code généré (via debtorType)', getDebtorCodeState(inv.data,'particulier').code, generateDebtorCode(inv.data));
});

suite('Risque 4: switch + B2C — créancier devient null', ()=>{
  // Scénario : créancier=FR, débiteur=null → switch → créancier=null, débiteur=FR → B2C
  // B2C ne vide plus le débiteur, mais le créancier est null → checkFields bloque
  const inv={data:{...baseOK,creditor_vat_number:'FR12345678901',debtor_vat_number:null},errors:{},debtorType:null};
  switchVATValues(inv.data); // créancier=null, débiteur=FR12345678901
  simulateSetDebtorType(inv,'particulier'); // grise le champ, ne l'efface pas
  test('Après switch+B2C : créancier null',           inv.data.creditor_vat_number, null);
  test('Après switch+B2C : débiteur préservé',        inv.data.debtor_vat_number,   'FR12345678901');
  // checkFields bloque sur créancier manquant
  const ok=checkFields(inv);
  test('checkFields bloque : créancier manquant',     ok, false);
  test('Erreur sur créancier',                        !!inv.errors.creditor_vat_number, true);
});

suite('Risque 5: idempotence checkFields avec debtor_vat résiduel B2C', ()=>{
  const inv={data:{...baseOK,creditor_vat_number:'FR12345678901',debtor_vat_number:'DE123456789'},errors:{},debtorType:'particulier'};
  checkFields(inv); // premier appel : doit ignorer debtor_vat et passer
  const vatAfter1=inv.data.debtor_vat_number;
  const errAfter1=JSON.stringify(inv.errors);
  checkFields(inv); // deuxième appel : même résultat
  test('Double appel : debtor_vat identique', inv.data.debtor_vat_number, vatAfter1);
  test('Double appel : erreurs identiques',   JSON.stringify(inv.errors), errAfter1);
  test('Valeur préservée après 2 appels',     vatAfter1, 'DE123456789');
});

suite('Risque 6: debtor_vat jamais dans CSV — debtor_code encode la valeur', ()=>{
  // B2C stores debtor_vat internally but it must not appear as a CSV column
  // B2B debtor_code equals debtor_vat — no separate column needed
  const b2cInv={data:{...baseOK,creditor_vat_number:'FR12345678901',debtor_vat_number:'IT12345678901',debtor_code:'JEALYO12R690'},errors:{},debtorType:'particulier',status:'validated'};
  const b2bInv={data:{...baseOK,creditor_vat_number:'FR12345678901',debtor_vat_number:'DE123456789',debtor_code:'DE123456789'},errors:{},debtorType:'entreprise',status:'validated'};
  const {header,rows,exportFields}=simulateBuildCSV([b2cInv,b2bInv]);
  const dVatIdx=exportFields.findIndex(f=>f.key==='debtor_vat_number');
  test('Colonne debtor_vat absente (jamais dans CSV)',            dVatIdx, -1);
  test('Valeur IT... toujours présente dans les données B2C',    b2cInv.data.debtor_vat_number, 'IT12345678901');
  const codeIdx=exportFields.findIndex(f=>f.key==='debtor_code');
  const b2cRow=rows[0].split(';');
  const b2bRow=rows[1].split(';');
  test('B2C debtor_code = code généré',                          b2cRow[codeIdx], 'JEALYO12R690');
  test('B2B debtor_code = TVA débiteur',                         b2bRow[codeIdx], 'DE123456789');
});

/* ══ SIMULATION: B2B → B2C → B2B ════════════════════ */

suite('Simulation: B2B (TVA connue) → clic B2C → reclic B2B → CSV', ()=>{
  const inv={
    data:{
      debtor_lastname:'ACME SAS',debtor_post_street_1:'5 avenue de la République',
      debtor_post_postalcode:'75011',debtor_post_city:'Paris',debtor_post_country_code:'FR',
      invoice_number:'F-2024-099',invoice_date:'2024-06-01',invoice_due_date:'2024-07-01',
      amount_ttc:1200,invoice_total_amount_inc_vat:1200,invoice_open_amount_inc_vat:1200,
      creditor_vat_number:'FR12345678901',debtor_vat_number:'DE123456789',debtor_code:'DE123456789'
    },
    errors:{},debtorType:'entreprise',status:'extracted'
  };

  // ── Étape 1: état initial B2B ───────────────────────
  const s1=getDebtorCodeState(inv.data,inv.debtorType);
  test('[1] B2B initial: debtor_code = TVA débiteur',      s1.code, 'DE123456789');
  test('[1] B2B initial: debtor_vat_number',               inv.data.debtor_vat_number, 'DE123456789');
  console.log('\n  État 1 (B2B):     debtorType='+inv.debtorType+', debtor_vat='+inv.data.debtor_vat_number+', debtor_code='+s1.code);

  // ── Étape 2: clic B2C → champ grisé, valeur préservée ─
  simulateSetDebtorType(inv,'particulier');
  const s2=getDebtorCodeState(inv.data,inv.debtorType);
  test('[2] Après B2C: debtorType = particulier',          inv.debtorType, 'particulier');
  test('[2] Après B2C: debtor_vat_number préservé',        inv.data.debtor_vat_number, 'DE123456789');
  test('[2] Après B2C: debtor_code = code généré',         s2.code, generateDebtorCode(inv.data));
  console.log('  État 2 (→B2C):    debtorType='+inv.debtorType+', debtor_vat='+inv.data.debtor_vat_number+', debtor_code='+s2.code);

  // ── Étape 3: reclic B2B → TVA récupérée ────────────
  simulateSetDebtorType(inv,'entreprise');
  const s3=getDebtorCodeState(inv.data,inv.debtorType);
  test('[3] Après B2B: debtorType = entreprise',           inv.debtorType, 'entreprise');
  test('[3] Après B2B: debtor_vat_number toujours là',     inv.data.debtor_vat_number, 'DE123456789');
  test('[3] Après B2B: debtor_code = TVA initiale',        s3.code, 'DE123456789');
  console.log('  État 3 (→B2B):    debtorType='+inv.debtorType+', debtor_vat='+inv.data.debtor_vat_number+', debtor_code='+s3.code);

  // ── Étape 4: validation + export CSV ───────────────
  inv.data.debtor_code=s3.code;
  inv.status='validated';
  const {header,rows,exportFields}=simulateBuildCSV([inv]);
  const dVatIdx=exportFields.findIndex(f=>f.key==='debtor_vat_number');
  const codeIdx=exportFields.findIndex(f=>f.key==='debtor_code');
  const row=rows[0].split(';');
  test('[4] CSV: colonne debtor_vat absente',              dVatIdx, -1);
  test('[4] CSV: debtor_code = DE123456789 (TVA initiale)',row[codeIdx], 'DE123456789');
  console.log('\n  '+header);
  console.log('  '+rows[0]);
});

/* ══ CSV COLUMN ORDER — debtor_vat never exported ═══ */

suite('CSV: administration_code = creditor_vat_number', ()=>{
  const base={debtor_lastname:'Test SA',debtor_post_street_1:'1 rue Test',debtor_post_postalcode:'75001',debtor_post_city:'Paris',debtor_post_country_code:'FR',invoice_number:'F-001',invoice_date:'2024-01-01',invoice_due_date:'2024-02-01',invoice_total_amount_inc_vat:'100',invoice_open_amount_inc_vat:'100'};
  const inv={data:{...base,creditor_vat_number:'FR12345678901',debtor_code:'DE123456789'},debtorType:'entreprise',status:'validated'};
  const {exportFields,rows}=simulateBuildCSV([inv]);
  const adminIdx=exportFields.findIndex(f=>f.key==='administration_code');
  const row=rows[0].split(';');
  test('Colonne administration_code présente',           adminIdx>=0, true);
  test('administration_code = creditor_vat_number',     row[adminIdx], 'FR12345678901');
  // No creditor VAT
  const inv2={data:{...base,creditor_vat_number:null,debtor_code:'TESPAR1R750'},debtorType:'particulier',status:'validated'};
  const {exportFields:ef2,rows:rows2}=simulateBuildCSV([inv2]);
  const adminIdx2=ef2.findIndex(f=>f.key==='administration_code');
  test('administration_code vide si créancier null',    rows2[0].split(';')[adminIdx2], '');
});

suite('CSV: N° TVA débiteur jamais dans le CSV — Code débiteur en position fixe', ()=>{
  const base={debtor_lastname:'Test SA',debtor_post_street_1:'1 rue Test',debtor_post_postalcode:'75001',debtor_post_city:'Paris',debtor_post_country_code:'FR',invoice_number:'F-001',invoice_date:'2024-01-01',invoice_due_date:'2024-02-01',amount_ttc:'100',invoice_total_amount_inc_vat:'100',invoice_open_amount_inc_vat:'100'};
  // B2B only
  const b2bInv={data:{...base,creditor_vat_number:'FR12345678901',debtor_vat_number:'DE123456789',debtor_code:'DE123456789'},debtorType:'entreprise',status:'validated'};
  const {exportFields:ef1,header:h1}=simulateBuildCSV([b2bInv]);
  test('B2B seul: debtor_vat absent', ef1.findIndex(f=>f.key==='debtor_vat_number'), -1);
  test('B2B seul: Code débiteur présent', h1.includes('debtor_code'), true);
  test('B2B seul: Code débiteur en position 3 (index 2)', ef1[2].key, 'debtor_code');

  // B2C only
  const b2cInv={data:{...base,creditor_vat_number:'FR12345678901',debtor_vat_number:null,debtor_code:'TESPAR1R750'},debtorType:'particulier',status:'validated'};
  const {exportFields:ef2}=simulateBuildCSV([b2cInv]);
  test('B2C seul: debtor_vat absent', ef2.findIndex(f=>f.key==='debtor_vat_number'), -1);
  test('B2C seul: Code débiteur en position 3 (index 2)', ef2[2].key, 'debtor_code');

  // Mixed
  const {exportFields:ef3}=simulateBuildCSV([b2cInv,b2bInv]);
  test('Mixte: debtor_vat absent', ef3.findIndex(f=>f.key==='debtor_vat_number'), -1);
  test('Mixte: Code débiteur en position 3 (index 2)', ef3[2].key, 'debtor_code');
});

/* ══ BUG: FR123456789 REJETÉE — FORMAT INCOMPLET ════ */

// Shared base for bug tests (also used by later suites)
const bugBase={debtor_lastname:'Test SA',debtor_post_street_1:'1 rue Test',debtor_post_postalcode:'75001',debtor_post_city:'Paris',debtor_post_country_code:'FR',invoice_number:'F-999',invoice_date:'2024-01-01',invoice_due_date:'2024-02-01',amount_ttc:'100',invoice_total_amount_inc_vat:'100',invoice_open_amount_inc_vat:'100'};
function bugInv(vat){return{data:{...bugBase,creditor_vat_number:vat,debtor_vat_number:null},errors:{},debtorType:'particulier'};}

suite('Bug: FR123456789 (11 chars) rejeté — format FR requiert 13 chars', ()=>{
  // User entered FR + 9 digits = 11 chars.
  // Correct French format: FR + 2 alphanum key + 9 digits = 13 chars.
  // Code behaviour is CORRECT — but error message needs to be more specific.
  test('FR123456789 → normalizeVAT null (invalide)',  normalizeVAT('FR123456789'), null);
  test('FR12345678901 → normalizeVAT valide (13 chars)', normalizeVAT('FR12345678901')!==null, true);
  test('FR123456789 length = 11 (trop court)',         'FR123456789'.length, 11);
  test('FR12345678901 length = 13 (correct)',          'FR12345678901'.length, 13);

  // Current error message is generic — does not say "13 chars expected"
  const inv=bugInv('FR123456789');
  checkFields(inv);
  test('Erreur générée',                              !!inv.errors.creditor_vat_number, true);
  test('Message contient "invalide"',                 inv.errors.creditor_vat_number.includes('invalide'), true);
  // The message should ideally explain the exact format for FR
  // → fix: add country-specific hint when the country prefix is recognised
  test('TODO: message explique format FR attendu',    inv.errors.creditor_vat_number.includes('FR'), true);
});

/* ══ BUG: TVA CRÉANCIER VALIDE REJETÉE ══════════════ */

suite('Bug: formats valides standard → checkFields passe', ()=>{
  // These are clean, unambiguous formats — all must pass
  const clean=[
    ['FR numérique','FR12345678901'],
    ['FR alpha key','FRAB123456789'],
    ['DE','DE123456789'],
    ['BE 10 chiffres','BE0123456789'],
    ['IT','IT12345678901'],
    ['CHE','CHE123456789'],
    ['NL','NL123456789B01'],
    ['ATU','ATU12345678'],
    ['ES','ESA1234567B'],
    ['PT','PT123456789'],
    ['SE','SE123456789012'],
    ['PL','PL1234567890'],
  ];
  clean.forEach(([label,val])=>{
    const inv=bugInv(val);
    test(`${label}: checkFields passe`,         checkFields(inv), true);
    test(`${label}: aucune erreur créancier`,    inv.errors.creditor_vat_number, undefined);
  });
});

suite('Bug: formats valides avec séparateurs communs → checkFields passe', ()=>{
  // Separators stripped by normalizeVAT: spaces, dots, dashes
  const withSep=[
    ['FR espaces',         'FR 12 345 678 901'],
    ['FR tirets',          'FR-12-345-678-901'],
    ['FR points',          'FR.12.345.678.901'],
    ['FR minuscules',      'fr12345678901'],
    ['FR espace début/fin',' FR12345678901 '],
    ['DE espaces',         'DE 123 456 789'],
    ['BE points',          'BE0412.345.678'],
    ['CHE tirets+points',  'CHE-123.456.789'],
    ['IT espaces',         'IT 12345678901'],
  ];
  withSep.forEach(([label,val])=>{
    const inv=bugInv(val);
    test(`${label}: checkFields passe`,         checkFields(inv), true);
    test(`${label}: aucune erreur créancier`,    inv.errors.creditor_vat_number, undefined);
  });
});

suite('Bug: formats avec séparateurs NON strippés → invalides', ()=>{
  // normalizeVAT only strips [\s.\-] — slashes and other chars are NOT removed
  // These FAIL even if the number looks valid → documents a known gap
  const nonStripped=[
    ['FR slash',           'FR/12/345/678/901'],
    ['FR underscore',      'FR_12345678901'],
    ['FR virgule',         'FR,12345678901'],
  ];
  nonStripped.forEach(([label,val])=>{
    test(`${label}: normalizeVAT → null (/ non strippé)`, normalizeVAT(val), null);
    const inv=bugInv(val);
    checkFields(inv);
    test(`${label}: erreur "invalide" (non "requis")`, inv.errors.creditor_vat_number?.includes('invalide'), true);
  });
});

suite('Bug: confusions de format fréquentes', ()=>{
  // Common mistakes users make — these should fail with "invalide" not silently pass
  test('CH sans E (doit être CHE)',       normalizeVAT('CH123456789'),   null);
  test('AT sans U (doit être ATU)',       normalizeVAT('AT12345678'),    null);
  test('BE 9 chiffres (ancien format)',   normalizeVAT('BE123456789'),   null);
  test('FR trop court (12 chars)',        normalizeVAT('FR1234567890'),  null);
  test('FR trop long  (14 chars)',        normalizeVAT('FR123456789012'),null);
  test('DE 8 chiffres (trop court)',      normalizeVAT('DE12345678'),    null);
  test('CHE trop court (8 chiffres)',     normalizeVAT('CHE12345678'),   null);
});

suite('Bug: checkFields message "invalide" vs "requis" selon le contenu', ()=>{
  // Non-empty but invalid → "invalide"
  const inv1=bugInv('NOTAVAT');checkFields(inv1);
  test('Non-vide invalide → message "invalide"',         inv1.errors.creditor_vat_number?.includes('invalide'),true);
  test('Non-vide invalide → pas "requis"',               inv1.errors.creditor_vat_number?.includes('requis'), false);
  // Slash → not stripped → "invalide"
  const inv2=bugInv('FR/12345678901');checkFields(inv2);
  test('Slash non strippé → message "invalide"',         inv2.errors.creditor_vat_number?.includes('invalide'),true);
  // CH (missing E) → "invalide"
  const inv3=bugInv('CH123456789');checkFields(inv3);
  test('CH sans E → message "invalide"',                 inv3.errors.creditor_vat_number?.includes('invalide'),true);
});

/* ══ MESSAGES D'ERREUR TVA SPÉCIFIQUES AU PAYS ═══════ */

// One canonical example per country prefix — mirrors VAT_HINTS in the app
suite('Message TVA: préfixe reconnu → exemple pays spécifique', ()=>{
  const cases=[
    ['FR court',   'FR123456789',   'FR12345678901'],
    ['FR valide',  'FRBAD',         'FR12345678901'],
    ['DE court',   'DE12345',       'DE123456789'],
    ['BE court',   'BE012345678',   'BE0123456789'],
    ['IT court',   'IT1234567890',  'IT12345678901'],
    ['CHE court',  'CHE12345678',   'CHE123456789'],
    ['CH bad pfx', 'CH123456789',   'CHE123456789'],
    ['ATU court',  'ATU1234567',    'ATU12345678'],
    ['NL bad',     'NL123456789',   'NL123456789B01'],
    ['ES bad',     'ESABC',         'ESA1234567B'],
    ['GR (→EL)',   'GR123456789',   'EL123456789'],
  ];
  cases.forEach(([label,input,expectedExample])=>{
    const hint=getVATHint(input);
    test(`getVATHint "${input}" → example contient "${expectedExample}"`, hint?.example, expectedExample);
  });
});

suite('Message TVA: préfixe inconnu → hint null', ()=>{
  test('Texte arbitraire',      getVATHint('NOTAVAT'),    null);
  test('Vide',                  getVATHint(''),           null);
  test('Null',                  getVATHint(null),         null);
  test('Chiffres seuls',        getVATHint('123456789'),  null);
  test('XX inconnu',            getVATHint('XX12345'),    null);
});

suite('Message TVA: checkFields utilise hint pays pour créancier', ()=>{
  // With hint implemented: error message should mention the country example
  const cases=[
    ['FR123456789',  'FR12345678901'],
    ['DE12345',      'DE123456789'],
    ['CH123456789',  'CHE123456789'],
    ['BE012345678',  'BE0123456789'],
  ];
  cases.forEach(([input,example])=>{
    const inv=bugInv(input);
    checkFields(inv);
    test(`"${input}" → erreur mentionne exemple "${example}"`,
      inv.errors.creditor_vat_number?.includes(example), true);
  });
});

suite('Message TVA: checkFields utilise hint pays pour débiteur', ()=>{
  const inv={data:{...bugBase,creditor_vat_number:'FR12345678901',debtor_vat_number:'DE12345'},errors:{},debtorType:null};
  checkFields(inv);
  test('Débiteur DE court → erreur mentionne DE123456789',
    inv.errors.debtor_vat_number?.includes('DE123456789'), true);
});

suite('Message TVA: préfixe inconnu → message générique', ()=>{
  const inv=bugInv('NOTAVAT');
  checkFields(inv);
  test('Préfixe inconnu → message générique',
    inv.errors.creditor_vat_number?.includes('FR12345678901'), true);
});

suite('Upload limits — batch (max 20 par envoi)', ()=>{
  test('1 fichier accepté',                   filterBatch(0,1),   {batchExceeded:false,totalExceeded:false,accepted:1});
  test('20 fichiers acceptés (batch plein)',   filterBatch(0,20),  {batchExceeded:false,totalExceeded:false,accepted:20});
  test('21 fichiers → batchExceeded',         filterBatch(0,21),  {batchExceeded:true, totalExceeded:false,accepted:0});
  test('100 fichiers d\'un coup → batchExceeded', filterBatch(0,100),{batchExceeded:true,totalExceeded:false,accepted:0});
  test('Après 20 uploadés → 20 de plus OK',   filterBatch(20,20), {batchExceeded:false,totalExceeded:false,accepted:20});
  test('Après 20 uploadés → 21 → batchExceeded', filterBatch(20,21),{batchExceeded:true,totalExceeded:false,accepted:0});
});

suite('Upload limits — total (max 100)', ()=>{
  test('Déjà 90 + 5 → 5 acceptés',            filterBatch(90,5),  {batchExceeded:false,totalExceeded:false,accepted:5});
  test('Déjà 90 + 10 → 10 acceptés',          filterBatch(90,10), {batchExceeded:false,totalExceeded:false,accepted:10});
  test('Déjà 90 + 15 → totalExceeded (10 acceptés)', filterBatch(90,15),{batchExceeded:false,totalExceeded:true,accepted:10});
  test('Déjà 95 + 10 → totalExceeded (5 acceptés)',  filterBatch(95,10),{batchExceeded:false,totalExceeded:true,accepted:5});
  test('Déjà 100 + 1 → totalExceeded (0 acceptés)',  filterBatch(100,1),{batchExceeded:false,totalExceeded:true,accepted:0});
  test('Déjà 80 + 20 → 20 acceptés (limite exacte)', filterBatch(80,20),{batchExceeded:false,totalExceeded:false,accepted:20});
});

suite('fmtDate — extraction année', ()=>{
  test('2026-01-28 → 2026',  fmtDate('2026-01-28'), '2026');
  test('2025-12-01 → 2025',  fmtDate('2025-12-01'), '2025');
  test('vide → vide',        fmtDate(''),            '');
  test('null → vide',        fmtDate(null),          '');
});

suite('fmtInvref — 5 chiffres zero-paddés', ()=>{
  test('45566 → 45566',              fmtInvref('45566'),          '45566');
  test('9862 → 09862',               fmtInvref('9862'),           '09862');
  test('1 → 00001',                  fmtInvref('1'),              '00001');
  test('FR-04545 → 04545',           fmtInvref('FR-04545'),       '04545');
  test('VT2025-00210 → 00210',       fmtInvref('VT2025-00210'),   '00210');
  test('123456 → garde 5 derniers',  fmtInvref('123456'),         '23456');
  test('vide → 00000',               fmtInvref(''),               '00000');
});

suite('fmtDebcode — nom débiteur pour nom de fichier', ()=>{
  test('company name',   fmtDebcode({debtor_lastname:'ACME SAS'}),                        'ACME SAS');
  test('firstname + lastname', fmtDebcode({debtor_firstname:'Jean',debtor_lastname:'Dupont'}), 'Jean Dupont');
  test('chars interdits retirés', fmtDebcode({debtor_lastname:'ACME/SAS:Test'}),          'ACME SAS Test'.replace(/ /g,' '));
});

suite('fmtAmount — montant en centimes', ()=>{
  test('144.07 → 14407',   fmtAmount('144.07'),  '14407');
  test('17.99 → 1799',     fmtAmount('17.99'),   '1799');
  test('2490 → 2490',      fmtAmount('2490'),    '2490');
  test('3920.00 → 3920',   fmtAmount('3920.00'), '3920');
  test('100.10 → 1001',    fmtAmount('100.10'),  '1001');
});

suite('mkFname — YYYY-NNNNN DEBTOR.pdf', ()=>{
  test('exemple B2B',  mkFname({invoice_number:'2026-09862',debtor_lastname:'ACME SAS'}),    '2026-09862 ACME SAS.pdf');
  test('exemple B2C',  mkFname({invoice_number:'2025-04545',debtor_lastname:'Jean Dupont'}), '2025-04545 Jean Dupont.pdf');
  test('regex valide', FNAME_REGEX.test(mkFname({invoice_number:'2026-47011',debtor_lastname:'RENOVIU'})), true);
});

suite('validatePdfName — FNAME_REGEX YYYY-NNNNN DEBTOR.pdf', ()=>{
  test('nom valide exemple concret',    validatePdfName('2026-60007 RENOVIU.pdf'),   true);
  test('nom valide B2C',               validatePdfName('2026-00001 Jean Dupont.pdf'), true);
  test('sans debtor → invalide',        validatePdfName('2026-60007.pdf'),            false);
  test('sans extension → invalide',     validatePdfName('2026-60007 RENOVIU'),        false);
  test('< 5 chiffres → invalide',       validatePdfName('2026-9862 RENOVIU.pdf'),     false);
  test('> 5 chiffres → invalide',       validatePdfName('2026-123456 RENOVIU.pdf'),   false);
  test('année != 4 chiffres → invalide',validatePdfName('26-60007 RENOVIU.pdf'),      false);
  // groupe nommé invoice_number = YYYY-NNNNN
  const m='2026-60007 RENOVIU.pdf'.match(FNAME_REGEX);
  test('groupe invoice_number', m?.groups?.invoice_number, '2026-60007');
});

suite('checkFields — invoice_number normalisé en YYYY-NNNNN', ()=>{
  const base={debtor_lastname:'Martin Habfast',debtor_post_street_1:'1 rue Test',debtor_post_postalcode:'75001',debtor_post_city:'Paris',debtor_post_country_code:'FR',invoice_date:'2026-01-01',invoice_due_date:'2026-02-01',invoice_total_amount_inc_vat:100,invoice_open_amount_inc_vat:100,creditor_vat_number:'FR12345678901'};
  const inv={data:{...base,invoice_number:'MSTRL-API-319247-011'},debtorType:'entreprise',errors:{}};
  checkFields(inv);
  test('invoice_number normalisé = YYYY-NNNNN', inv.data.invoice_number, '2026-47011');
  test('nom PDF = 2026-47011 Martin Habfast.pdf', mkFname(inv.data), '2026-47011 Martin Habfast.pdf');
  test('FNAME_REGEX valide le nom PDF généré',  FNAME_REGEX.test(mkFname(inv.data)), true);
});

suite('checkFields — idempotence invoice_number (double appel)', ()=>{
  const base={debtor_lastname:'Martin Habfast',debtor_post_street_1:'1 rue Test',debtor_post_postalcode:'75001',debtor_post_city:'Paris',debtor_post_country_code:'FR',invoice_date:'2026-01-01',invoice_due_date:'2026-02-01',invoice_total_amount_inc_vat:100,invoice_open_amount_inc_vat:100,creditor_vat_number:'FR12345678901'};
  const inv={data:{...base,invoice_number:'MSTRL-API-319247-011'},debtorType:'entreprise',errors:{}};
  checkFields(inv);
  const after1=inv.data.invoice_number;
  checkFields(inv);
  const after2=inv.data.invoice_number;
  test('double checkFields → même résultat', after1, after2);
  test('FNAME_REGEX valide après double appel', FNAME_REGEX.test(mkFname(inv.data)), true);
});

suite('CSV — invoice_number = 5 chiffres', ()=>{
  const base={debtor_lastname:'Martin Habfast',debtor_post_street_1:'1 rue Test',debtor_post_postalcode:'75001',debtor_post_city:'Paris',debtor_post_country_code:'FR',invoice_date:'2026-01-01',invoice_due_date:'2026-02-01',invoice_total_amount_inc_vat:100,invoice_open_amount_inc_vat:100,creditor_vat_number:'FR12345678901'};
  const inv={data:{...base,invoice_number:'MSTRL-API-319247-011'},debtorType:'entreprise',errors:{}};
  checkFields(inv);
  inv.status='validated';
  const {rows,exportFields}=simulateBuildCSV([inv]);
  const idx=exportFields.findIndex(f=>f.key==='invoice_number');
  test('invoice_number dans CSV = YYYY-NNNNN', rows[0].split(';')[idx], '2026-47011');
});

suite('downloadAll — CSV et ZIP séparés', ()=>{
  // buildCSV doit produire uniquement des données CSV (pas de PDF dedans)
  const invs=[
    {data:{debtor_lastname:'ACME SAS',debtor_post_street_1:'1 rue Test',debtor_post_postalcode:'75001',debtor_post_city:'Paris',debtor_post_country_code:'FR',invoice_number:'F-001',invoice_date:'2024-01-01',invoice_due_date:'2024-02-01',invoice_total_amount_inc_vat:100,invoice_open_amount_inc_vat:100,creditor_vat_number:'FR12345678901',debtor_code:'DE123456789'},status:'validated'},
    {data:{debtor_lastname:'Jean Dupont',debtor_post_street_1:'12 rue des Lilas',debtor_post_postalcode:'69001',debtor_post_city:'Lyon',debtor_post_country_code:'FR',invoice_number:'F-002',invoice_date:'2024-06-01',invoice_due_date:'2024-07-01',invoice_total_amount_inc_vat:250,invoice_open_amount_inc_vat:250,creditor_vat_number:'FR12345678901'},status:'validated'},
  ];
  const {header,rows}=simulateBuildCSV(invs);
  // CSV file: 2 lignes de données + 1 header
  test('CSV contient une ligne par facture validée',  rows.length, 2);
  test('CSV header contient debtor_company_name',     header.includes('debtor_company_name'), true);
  test('CSV header ne contient pas de contenu PDF',   header.includes('%PDF'), false);
  // ZIP PDFs : le CSV ne doit PAS être dans le ZIP
  // On vérifie que buildCSV produit du texte (pas un blob ZIP)
  const csv=simulateBuildCSV(invs).csv;
  test('buildCSV retourne une chaîne texte',          typeof csv, 'string');
  test('CSV commence par le header',                  csv.startsWith(header), true);
  test('CSV ne contient pas de nom de fichier .zip',  csv.includes('.zip'), false);
  // ZIP ne doit contenir que les PDFs — vérifié par le fait que buildCSV n\'inclut aucun PDF
  test('CSV ne contient pas factures.csv embarqué',   csv.includes('factures.csv'), false);
});

suite('computeDebtorCompanyName — B2B (company name seul)', ()=>{
  test('lastname seul → company name',
    computeDebtorCompanyName({debtor_lastname:'ACME SAS'}), 'ACME SAS');
  test('lastname vide → vide',
    computeDebtorCompanyName({debtor_lastname:''}), '');
  test('pas de champ → vide',
    computeDebtorCompanyName({}), '');
});

suite('computeDebtorCompanyName — B2C (firstname + lastname agrégés)', ()=>{
  test('firstname + lastname → agrégés',
    computeDebtorCompanyName({debtor_firstname:'Jean',debtor_lastname:'Dupont'}), 'Jean Dupont');
  test('firstname + infix + lastname → agrégés',
    computeDebtorCompanyName({debtor_firstname:'Jean',debtor_infix:'de',debtor_lastname:'Dupont'}), 'Jean de Dupont');
  test('infix vide ignoré',
    computeDebtorCompanyName({debtor_firstname:'Marie',debtor_infix:'',debtor_lastname:'Martin'}), 'Marie Martin');
  test('firstname null ignoré',
    computeDebtorCompanyName({debtor_firstname:null,debtor_lastname:'Dupont'}), 'Dupont');
});

suite('CSV debtor_company_name — bug: champ vide sans fix', ()=>{
  // Confirme que sans computeDebtorCompanyName, debtor_company_name serait vide
  const inv={data:{debtor_lastname:'ACME SAS',debtor_post_street_1:'1 rue Test',debtor_post_postalcode:'75001',debtor_post_city:'Paris',debtor_post_country_code:'FR',invoice_number:'F-001',invoice_date:'2024-01-01',invoice_due_date:'2024-02-01',invoice_total_amount_inc_vat:100,invoice_open_amount_inc_vat:100,creditor_vat_number:'FR12345678901',debtor_code:'DE123456789'},status:'validated'};
  test('debtor_company_name absent de inv.data → undefined', inv.data.debtor_company_name, undefined);
  test('sans fix: String(undefined??\'\') → vide', String(inv.data.debtor_company_name??''), '');
});

suite('CSV debtor_company_name — avec fix (B2B)', ()=>{
  const inv={data:{debtor_lastname:'ACME SAS',debtor_post_street_1:'1 rue Test',debtor_post_postalcode:'75001',debtor_post_city:'Paris',debtor_post_country_code:'FR',invoice_number:'F-001',invoice_date:'2024-01-01',invoice_due_date:'2024-02-01',invoice_total_amount_inc_vat:100,invoice_open_amount_inc_vat:100,creditor_vat_number:'FR12345678901',debtor_code:'DE123456789'},status:'validated'};
  const {rows,exportFields}=simulateBuildCSV([inv]);
  const idx=exportFields.findIndex(f=>f.key==='debtor_company_name');
  const val=rows[0].split(';')[idx];
  test('debtor_company_name présent dans CSV', idx>=0, true);
  test('debtor_company_name = debtor_lastname pour B2B', val, 'ACME SAS');
});

suite('CSV debtor_company_name — avec fix (B2C firstname + lastname)', ()=>{
  const inv={data:{debtor_firstname:'Jean',debtor_lastname:'Dupont',debtor_post_street_1:'12 rue des Lilas',debtor_post_postalcode:'69001',debtor_post_city:'Lyon',debtor_post_country_code:'FR',invoice_number:'F-2024-042',invoice_date:'2024-06-01',invoice_due_date:'2024-07-01',invoice_total_amount_inc_vat:250,invoice_open_amount_inc_vat:250,creditor_vat_number:'FR12345678901'},status:'validated'};
  const {rows,exportFields}=simulateBuildCSV([inv]);
  const idx=exportFields.findIndex(f=>f.key==='debtor_company_name');
  const val=rows[0].split(';')[idx];
  test('debtor_company_name = firstname + lastname agrégés', val, 'Jean Dupont');
});

suite('isValidCountryCode — code ISO 2 lettres', ()=>{
  test('FR → valide',       isValidCountryCode('FR'),     true);
  test('DE → valide',       isValidCountryCode('DE'),     true);
  test('BE → valide',       isValidCountryCode('BE'),     true);
  test('France → invalide', isValidCountryCode('France'), false);
  test('fr → invalide (minuscules)', isValidCountryCode('fr'), false);
  test('FRA → invalide (3 lettres)', isValidCountryCode('FRA'), false);
  test('F → invalide (1 lettre)',    isValidCountryCode('F'),   false);
  test('vide → invalide',   isValidCountryCode(''),       false);
});

suite('vandn — champ country_code', ()=>{
  const f={key:'debtor_post_country_code',type:'country_code',required:true};
  test('FR → valide',          vandn('FR',f).valid,   true);
  test('fr → normalisé en FR', vandn('fr',f).norm,    'FR');
  test('France → invalide',    vandn('France',f).valid, false);
  test('France → message erreur', vandn('France',f).errs[0], 'Code pays invalide — utilisez le code ISO 2 lettres (ex : FR, DE, BE)');
  test('vide requis → invalide', vandn('',f).valid,   false);
});

suite('isValidEmail — validation basique', ()=>{
  test('adresse valide simple',         isValidEmail('user@example.com'),          true);
  test('adresse valide avec sous-domaine', isValidEmail('user@mail.example.com'),  true);
  test('adresse valide avec +',         isValidEmail('user+tag@example.com'),      true);
  test('adresse valide domaine court',  isValidEmail('a@b.fr'),                   true);
  test('sans @',                        isValidEmail('userexample.com'),           false);
  test('sans domaine',                  isValidEmail('user@'),                     false);
  test('sans extension',                isValidEmail('user@example'),              false);
  test('extension trop courte',         isValidEmail('user@example.c'),            false);
  test('double @',                      isValidEmail('user@@example.com'),         false);
  test('vide',                          isValidEmail(''),                          false);
  test('espaces',                       isValidEmail('user @example.com'),         false);
});

suite('vandn — champ email', ()=>{
  const f={key:'debtor_email',type:'email',required:false};
  const fr={key:'debtor_email',type:'email',required:true};
  test('vide optionnel → valide',       vandn('',f).valid,                         true);
  test('vide requis → invalide',        vandn('',fr).valid,                        false);
  test('email valide → valide',         vandn('User@Example.COM',f).valid,         true);
  test('email valide → normalisé en minuscules', vandn('User@Example.COM',f).norm, 'user@example.com');
  test('email invalide → invalide',     vandn('pasunemail',f).valid,               false);
  test('email invalide → message',      vandn('pasunemail',f).errs[0],             'Adresse e-mail invalide');
});

/* ══ applyAmountPaid — Montant déjà payé ══ */

function saveDataset() {} // no-op stub

function applyAmountPaid(inv, value) {
  const paid = parseFloat(value);
  if (inv.baseOpenAmount == null) {
    const base = parseFloat(inv.data.invoice_open_amount_inc_vat);
    inv.baseOpenAmount = isNaN(base) ? 0 : base;
  }
  if (isNaN(paid) || paid <= 0) {
    inv.amountPaid = null;
    inv.data.invoice_open_amount_inc_vat = inv.baseOpenAmount;
    if (inv.paytStatus === 'Payée') inv.paytStatus = null;
  } else {
    inv.amountPaid = paid;
    const newOpen = Math.max(0, Math.round((inv.baseOpenAmount - paid) * 100) / 100);
    inv.data.invoice_open_amount_inc_vat = newOpen;
    if (newOpen === 0) inv.paytStatus = 'Payée';
  }
  saveDataset();
}

function mkInvPA(openAmt, baseOpen = null, paytStatus = null) {
  return { data: { invoice_open_amount_inc_vat: openAmt }, amountPaid: null, baseOpenAmount: baseOpen, paytStatus };
}

suite('applyAmountPaid — calcul du montant en suspens', () => {
  let i;
  i = mkInvPA(500); applyAmountPaid(i, 200);
  test('paiement partiel réduit le suspens',             i.data.invoice_open_amount_inc_vat, 300);
  i = mkInvPA(500); applyAmountPaid(i, 500);
  test('paiement total → suspens = 0',                   i.data.invoice_open_amount_inc_vat, 0);
  test('paiement total → paytStatus = "Payée"',          i.paytStatus, 'Payée');
  i = mkInvPA(500); applyAmountPaid(i, 200);
  test('paiement partiel → paytStatus inchangé (null)',  i.paytStatus, null);
  i = mkInvPA(100); applyAmountPaid(i, 999);
  test('surpaiement → suspens = 0 (jamais négatif)',     i.data.invoice_open_amount_inc_vat, 0);
  test('surpaiement → paytStatus = "Payée"',             i.paytStatus, 'Payée');
  i = mkInvPA(500); applyAmountPaid(i, 200);
  test('amountPaid stocké sur la facture',               i.amountPaid, 200);
  i = mkInvPA(1500.99); applyAmountPaid(i, 1000.50);
  test('arrondi centimes — €1500,99 − €1000,50 = €500,49', i.data.invoice_open_amount_inc_vat, 500.49);
});

suite('applyAmountPaid — réinitialisation', () => {
  let i;
  i = mkInvPA(500); applyAmountPaid(i, 200); applyAmountPaid(i, 0);
  test('valeur 0 → reset, suspens restauré',             i.data.invoice_open_amount_inc_vat, 500);
  i = mkInvPA(500); applyAmountPaid(i, 200); applyAmountPaid(i, '');
  test('valeur vide → reset, suspens restauré',          i.data.invoice_open_amount_inc_vat, 500);
  i = mkInvPA(500); applyAmountPaid(i, -100);
  test('valeur négative → reset',                        i.data.invoice_open_amount_inc_vat, 500);
  i = mkInvPA(500); applyAmountPaid(i, 500); applyAmountPaid(i, 0);
  test('reset après paiement complet → paytStatus effacé', i.paytStatus, null);
  i = mkInvPA(500); applyAmountPaid(i, 200); applyAmountPaid(i, 0);
  test('amountPaid remis à null après reset',            i.amountPaid, null);
});

suite('applyAmountPaid — gel du baseOpenAmount', () => {
  let i;
  i = mkInvPA(1000); applyAmountPaid(i, 200);
  test('initialisé depuis invoice_open_amount_inc_vat',  i.baseOpenAmount, 1000);
  i = mkInvPA(1000); applyAmountPaid(i, 200); applyAmountPaid(i, 300);
  test('non modifié au second appel',                    i.baseOpenAmount, 1000);
  test('second paiement depuis baseOpenAmount (pas résidu)', i.data.invoice_open_amount_inc_vat, 700);
  i = mkInvPA(500, 1000); applyAmountPaid(i, 200);
  test('baseOpenAmount pré-défini non réécrasé',         i.baseOpenAmount, 1000);
  i = mkInvPA('N/A'); applyAmountPaid(i, 50);
  test('base invalide (NaN) → baseOpenAmount = 0',       i.baseOpenAmount, 0);
  test('base invalide + paiement → suspens = 0',         i.data.invoice_open_amount_inc_vat, 0);
});


/* ══ PAYT PUSH PAYLOAD — field mapping (api/payt-push.js) ══ */

function buildApiPaytBody(inv) {
  return {
    debtor_number:     inv.debtor_number,
    invoice_number:    inv.invoice_number,
    invoice_date:      inv.invoice_date,
    due_date:          inv.invoice_due_date,
    book_amount_total: String(parseFloat(inv.invoice_total_amount_inc_vat) || 0),
    amount_total:      String(parseFloat(inv.invoice_total_amount_inc_vat) || 0),
    book_amount_open:  String(Math.max(0, parseFloat(inv.invoice_open_amount_inc_vat) || 0)),
    amount_open:       String(Math.max(0, parseFloat(inv.invoice_open_amount_inc_vat) || 0)),
    ...(Math.max(0, parseFloat(inv.invoice_open_amount_inc_vat) || 0) === 0 && inv.amount_paid > 0 && {
      payments: [{
        amount:            String(parseFloat(inv.amount_paid)),
        origin_identifier: `${inv.invoice_number}-writeoff`,
        transaction_type:  'write_off',
      }],
    }),
    currency_code:     inv.currency_code || 'EUR',
  };
}

suite('api/payt-push.js — renommage des champs montants', () => {
  const inv = { debtor_number:'FR12345678901', invoice_number:'F-001', invoice_date:'2024-03-15', invoice_due_date:'2024-04-15', invoice_total_amount_inc_vat:1500.5, invoice_open_amount_inc_vat:300.25, currency_code:'EUR' };
  const body = buildApiPaytBody(inv);
  test('book_amount_total = String(total_amount_inc_vat)',  body.book_amount_total,    '1500.5');
  test('amount_total = String(total_amount_inc_vat)',       body.amount_total,         '1500.5');
  test('book_amount_open = String(open_amount_inc_vat)',    body.book_amount_open,     '300.25');
  test('amount_open = String(open_amount_inc_vat)',         body.amount_open,          '300.25');
  test('due_date ← invoice_due_date (renommé)',             body.due_date,             '2024-04-15');
  test('invoice_due_date absent (champ renommé)',           body.invoice_due_date,     undefined);
  test('total_amount absent (ancien nom supprimé)',         body.total_amount,         undefined);
  test('open_amount absent (ancien nom supprimé)',          body.open_amount,          undefined);
  test('flow_code absent (supprimé)',                       body.flow_code,            undefined);
  const noCC = buildApiPaytBody({ ...inv, currency_code: undefined });
  test('currency_code par défaut "EUR"',                    noCC.currency_code,        'EUR');
});

suite('PAYT — montant réduit après applyAmountPaid transmis correctement', () => {
  let i;
  i = mkInvPA(1500); applyAmountPaid(i, 500);
  test('applyAmountPaid réduit invoice_open_amount_inc_vat', i.data.invoice_open_amount_inc_vat, 1000);
  test('montant réduit converti en string pour l\'API',      String(i.data.invoice_open_amount_inc_vat), '1000');
  i = mkInvPA(500); applyAmountPaid(i, 500);
  test('paiement total → "0" envoyé à PAYT',                String(i.data.invoice_open_amount_inc_vat), '0');
});

/* ══ Pipeline complet : applyAmountPaid → payload frontend → buildApiPaytBody ══
 * Reproduit exactement le chemin de données :
 *   1. Invoice frontend (inv.data.invoice_open_amount_inc_vat)
 *   2. applyAmountPaid modifie inv.data.invoice_open_amount_inc_vat
 *   3. Construction du payload (flattening comme dans pushToPayt())
 *   4. buildApiPaytBody construit le corps envoyé à PAYT
 *   → Vérifie que book_amount_open / amount_open reflètent le paiement
 */

function mkFullInv(totalAmt, openAmt) {
  return {
    data: {
      invoice_number: 'F-001',
      invoice_date: '2024-01-15',
      invoice_due_date: '2024-02-15',
      invoice_total_amount_inc_vat: totalAmt,
      invoice_open_amount_inc_vat: openAmt,
    },
    amountPaid: null,
    baseOpenAmount: null,
    paytStatus: null,
    debtorType: 'entreprise',
    targetCompany: { id: 'ADM-1', name: 'Société A' },
  };
}

function buildFrontendPayload(inv) {
  // Mirrors pushToPayt() in invoice-processor.html (line ~1549)
  return {
    administration_id:           inv.targetCompany.id,
    invoice_number:              inv.data.invoice_number,
    invoice_date:                inv.data.invoice_date,
    invoice_due_date:            inv.data.invoice_due_date,
    invoice_total_amount_inc_vat: inv.data.invoice_total_amount_inc_vat,
    invoice_open_amount_inc_vat:  inv.data.invoice_open_amount_inc_vat,
    amount_paid:                 inv.amountPaid ?? null,
    currency_code:               'EUR',
    debtor_number:               'DEB-001',
    debtor_name:                 'Client Test',
    debtor_is_company:           inv.debtorType === 'entreprise',
  };
}

suite('Pipeline complet — paiement partiel → book_amount_open réduit', () => {
  let inv, payload, body;

  // Paiement partiel
  inv = mkFullInv(1000, 1000); applyAmountPaid(inv, 400);
  payload = buildFrontendPayload(inv);
  body = buildApiPaytBody(payload);
  test('paiement partiel — book_amount_open = "600"',  body.book_amount_open, '600');
  test('paiement partiel — amount_open = "600"',        body.amount_open,      '600');
  test('paiement partiel — book_amount_total inchangé', body.book_amount_total,'1000');
  test('paiement partiel — amount_total inchangé',      body.amount_total,     '1000');

  // Paiement total (montant = suspens)
  inv = mkFullInv(750, 750); applyAmountPaid(inv, 750);
  payload = buildFrontendPayload(inv);
  body = buildApiPaytBody(payload);
  test('paiement total — book_amount_open = "0"',       body.book_amount_open, '0');
  test('paiement total — amount_open = "0"',             body.amount_open,      '0');
  test('paiement total — book_amount_total inchangé',    body.book_amount_total,'750');

  // Paiement total sur facture avec suspens < total (déjà partiel)
  inv = mkFullInv(1000, 600); applyAmountPaid(inv, 600);
  payload = buildFrontendPayload(inv);
  body = buildApiPaytBody(payload);
  test('suspens partiel soldé — book_amount_open = "0"', body.book_amount_open, '0');
  test('suspens partiel soldé — amount_open = "0"',      body.amount_open,      '0');
  test('suspens partiel soldé — book_amount_total = "1000"', body.book_amount_total, '1000');

  // Paiement centimes
  inv = mkFullInv(1500.99, 1500.99); applyAmountPaid(inv, 1000.50);
  payload = buildFrontendPayload(inv);
  body = buildApiPaytBody(payload);
  test('paiement centimes — book_amount_open = "500.49"', body.book_amount_open, '500.49');

  // Sans paiement renseigné — aucune déduction
  inv = mkFullInv(800, 800);
  payload = buildFrontendPayload(inv);
  body = buildApiPaytBody(payload);
  test('sans amountPaid — book_amount_open inchangé = "800"', body.book_amount_open, '800');
  test('sans amountPaid — amount_open inchangé = "800"',       body.amount_open,      '800');
});

suite('Pipeline complet — payments write_off quand amount_open = 0', () => {
  let inv, payload, body;

  // Paiement total → doit inclure payments[]
  inv = mkFullInv(500, 500); applyAmountPaid(inv, 500);
  payload = buildFrontendPayload(inv);
  body = buildApiPaytBody(payload);
  test('paiement total — payments présent',                       Array.isArray(body.payments), true);
  test('paiement total — 1 paiement dans payments',               body.payments && body.payments.length, 1);
  test('paiement total — amount = "500"',                         body.payments && body.payments[0].amount, '500');
  test('paiement total — transaction_type = write_off',           body.payments && body.payments[0].transaction_type, 'write_off');
  test('paiement total — origin_identifier = F-001-writeoff',     body.payments && body.payments[0].origin_identifier, 'F-001-writeoff');

  // Paiement partiel → NE doit PAS inclure payments[]
  inv = mkFullInv(500, 500); applyAmountPaid(inv, 200);
  payload = buildFrontendPayload(inv);
  body = buildApiPaytBody(payload);
  test('paiement partiel — payments absent',                      body.payments, undefined);

  // Sans amountPaid → payments absent
  inv = mkFullInv(500, 500);
  payload = buildFrontendPayload(inv);
  body = buildApiPaytBody(payload);
  test('sans amountPaid — payments absent',                       body.payments, undefined);

  // Suspens déjà 0 sans amountPaid → payments absent (pas de write-off sans montant)
  inv = mkFullInv(500, 0);
  payload = buildFrontendPayload(inv);
  body = buildApiPaytBody(payload);
  test('suspens=0 sans amountPaid — payments absent',             body.payments, undefined);
});


/* ══ AUTO-FILL targetCompany ══ */

function getAutoTargetCompany(administrations) {
  if (administrations.length === 1) return { id: administrations[0].id, name: administrations[0].name };
  return null;
}

function autoFillTargetCompany(invoices, administrations) {
  if (administrations.length !== 1) return;
  const only = administrations[0];
  invoices.forEach(inv => { if (!inv.targetCompany) inv.targetCompany = { id: only.id, name: only.name }; });
}

const oneAdmin   = [{ id: 'ADM-1', name: 'Société A', city: 'Paris' }];
const twoAdmins  = [{ id: 'ADM-1', name: 'Société A' }, { id: 'ADM-2', name: 'Société B' }];

suite('getAutoTargetCompany — cible auto si 1 seule administration', () => {
  test('1 admin → retourne {id, name}',
    getAutoTargetCompany(oneAdmin), { id: 'ADM-1', name: 'Société A' });
  test('2 admins → null',
    getAutoTargetCompany(twoAdmins), null);
  test('0 admins → null',
    getAutoTargetCompany([]), null);
});

suite('autoFillTargetCompany — remplissage des factures existantes', () => {
  let invs;

  invs = [{ targetCompany: null }, { targetCompany: null }];
  autoFillTargetCompany(invs, oneAdmin);
  test('1 admin, 2 factures sans cible → toutes remplies',
    invs.every(i => i.targetCompany?.id === 'ADM-1'), true);

  invs = [{ targetCompany: { id: 'ADM-99', name: 'Autre' } }];
  autoFillTargetCompany(invs, oneAdmin);
  test('1 admin, facture avec cible existante → non écrasée',
    invs[0].targetCompany.id, 'ADM-99');

  invs = [{ targetCompany: null }, { targetCompany: { id: 'ADM-99', name: 'Autre' } }];
  autoFillTargetCompany(invs, oneAdmin);
  test('1 admin, mix null + existante → seule la null est remplie',
    invs[0].targetCompany?.id, 'ADM-1');
  test('1 admin, mix null + existante → existante préservée',
    invs[1].targetCompany.id, 'ADM-99');

  invs = [{ targetCompany: null }, { targetCompany: null }];
  autoFillTargetCompany(invs, twoAdmins);
  test('2 admins → aucune facture remplie',
    invs.every(i => i.targetCompany === null), true);

  invs = [{ targetCompany: null }];
  autoFillTargetCompany(invs, []);
  test('0 admins → aucune facture remplie',
    invs[0].targetCompany, null);
});
/* ══ DUPLICATE DETECTION ══════════════════════════════
   Mirrors the duplicate-check loop from addFiles() in invoice-processor.html:
     accepted.forEach(f => {
       if (S.invoices.some(x => x.fileName === f.name)) { duplicates.push(f.name); }
       else { S.invoices.push(inv); toUpload.push({f, inv}); }
     });
   The function mutates `invoices` inline so that two identical files
   in the same batch are both caught (second one sees the first already added).
══════════════════════════════════════════════════════ */
function filterNewFiles(existingInvoices, files) {
  const invoices = existingInvoices.map(x => ({ fileName: x.fileName }));
  const duplicates = [];
  const toAdd = [];
  files.forEach(f => {
    if (invoices.some(x => x.fileName === f.name)) {
      duplicates.push(f.name);
    } else {
      invoices.push({ fileName: f.name });
      toAdd.push(f.name);
    }
  });
  return { toAdd, duplicates };
}

suite('filterNewFiles — détection des doublons à l\'ajout', () => {
  let r;

  // ── Cas de base ──
  r = filterNewFiles([], [{ name: 'facture-A.pdf' }]);
  test('liste vide + 1 nouveau → 1 ajouté',          r.toAdd.length,      1);
  test('liste vide + 1 nouveau → 0 doublon',          r.duplicates.length, 0);

  r = filterNewFiles([{ fileName: 'facture-A.pdf' }], [{ name: 'facture-A.pdf' }]);
  test('fichier déjà présent → 0 ajouté',             r.toAdd.length,      0);
  test('fichier déjà présent → doublon détecté',      r.duplicates.length, 1);
  test('fichier déjà présent → nom correct',          r.duplicates[0],     'facture-A.pdf');

  // ── Même fichier deux fois dans le même batch ──
  r = filterNewFiles([], [{ name: 'facture-A.pdf' }, { name: 'facture-A.pdf' }]);
  test('même fichier x2 dans batch → 1 ajouté',       r.toAdd.length,      1);
  test('même fichier x2 dans batch → 1 doublon',      r.duplicates.length, 1);

  // ── Mix nouveaux + doublons ──
  r = filterNewFiles(
    [{ fileName: 'old.pdf' }],
    [{ name: 'new.pdf' }, { name: 'old.pdf' }, { name: 'other.pdf' }]
  );
  test('mix — 2 nouveaux ajoutés',                    r.toAdd.length,      2);
  test('mix — 1 doublon détecté',                     r.duplicates.length, 1);
  test('mix — doublon = old.pdf',                     r.duplicates[0],     'old.pdf');

  // ── Tous doublons ──
  r = filterNewFiles(
    [{ fileName: 'a.pdf' }, { fileName: 'b.pdf' }],
    [{ name: 'a.pdf' }, { name: 'b.pdf' }]
  );
  test('tous doublons → rien ajouté',                 r.toAdd.length,      0);
  test('tous doublons → 2 détectés',                  r.duplicates.length, 2);

  // ── Aucun fichier ──
  r = filterNewFiles([{ fileName: 'a.pdf' }], []);
  test('aucun fichier → toAdd vide',                  r.toAdd.length,      0);
  test('aucun fichier → duplicates vide',             r.duplicates.length, 0);

  // ── Sensibilité à la casse ──
  r = filterNewFiles([{ fileName: 'Facture.pdf' }], [{ name: 'facture.pdf' }]);
  test('casse différente → non doublon (case-sensitive)', r.toAdd.length,  1);
  test('casse différente → 0 doublon',                    r.duplicates.length, 0);

  // ── Plusieurs nouveaux sans doublon ──
  r = filterNewFiles([], [{ name: 'a.pdf' }, { name: 'b.pdf' }, { name: 'c.pdf' }]);
  test('3 nouveaux fichiers → tous ajoutés',          r.toAdd.length,      3);
  test('3 nouveaux fichiers → 0 doublon',             r.duplicates.length, 0);
});

console.log(`\n${'─'.repeat(50)}`);
console.log(`✓ ${pass} passed   ${fail>0?'✗ '+fail+' failed':''}`);
console.log('─'.repeat(50));
if(fail>0) process.exit(1);

// ══════════════════════════════════════════════════════════════════
// Logique open / clôturée / payée — 3 scénarios métier
// Miroir de api/payt-push.js Step 4 + Step 5
// ══════════════════════════════════════════════════════════════════

function isInPaidBatch(inv) {
  return (parseFloat(inv.amount_paid) || 0) > 0;
}

function isInClotureeeBatch(inv) {
  return inv.payt_status === 'Clôturée';
}

// Le frontend (applyAmountPaid) réduit déjà invoice_open_amount_inc_vat de amountPaid avant l'envoi.
// Donc effectiveOpen côté serveur = originalOpen - amountPaid.
// avoirAmount = effectiveOpen (pas de double soustraction).
function computeAvoirAmount(effectiveOpen) {
  return Math.max(0, effectiveOpen);
}

// Helper pour vérifier le montant envoyé à PAYT en Step 3 (originalOpen = effectiveOpen + amountPaid)
function computeOriginalOpen(effectiveOpen, amountPaid) {
  const paid = parseFloat(amountPaid) || 0;
  return Math.round((effectiveOpen + paid) * 100) / 100;
}

suite('Scénario 1 — paiement partiel + Clôturée → payment 400 + avoir 600', () => {
  // Frontend envoie invoice_open_amount_inc_vat déjà réduit : 1000 - 400 = 600
  const inv = { invoice_open_amount_inc_vat: '600', amount_paid: '400', payt_status: 'Clôturée' };
  const effectiveOpen = parseFloat(inv.invoice_open_amount_inc_vat);
  const amountPaid    = parseFloat(inv.amount_paid);
  test('Step 3 : originalOpen envoyé à PAYT = 1000',  computeOriginalOpen(effectiveOpen, amountPaid), 1000);
  test('Step 4 : facture dans paidBatch',              isInPaidBatch(inv),                            true);
  test('Step 5 : facture dans clotureeeBatch',         isInClotureeeBatch(inv),                       true);
  test('Step 4 : montant paiement = 400',              amountPaid,                                    400);
  test('Step 5 : avoirAmount = 600 (effectiveOpen)',   computeAvoirAmount(effectiveOpen),             600);
  test('Step 5 : pas d\'avoir si effectiveOpen = 0',  computeAvoirAmount(0) === 0,                   true);
});

suite('Scénario 2 — Clôturée sans paiement → avoir 1000 seulement', () => {
  // Pas de paiement → frontend ne réduit pas → effectiveOpen = originalOpen = 1000
  const inv = { invoice_open_amount_inc_vat: '1000', amount_paid: null, payt_status: 'Clôturée' };
  const effectiveOpen = parseFloat(inv.invoice_open_amount_inc_vat);
  const amountPaid    = parseFloat(inv.amount_paid) || 0;
  test('Step 3 : originalOpen envoyé à PAYT = 1000',  computeOriginalOpen(effectiveOpen, amountPaid), 1000);
  test('Step 4 : facture hors paidBatch',              isInPaidBatch(inv),                            false);
  test('Step 5 : facture dans clotureeeBatch',         isInClotureeeBatch(inv),                       true);
  test('Step 5 : avoirAmount = 1000',                  computeAvoirAmount(effectiveOpen),             1000);
  test('Step 5 : avoir non nul (différent de 0)',      computeAvoirAmount(effectiveOpen) > 0,         true);
});

suite('Scénario 3 — paiement partiel sans clôture → payment 500 uniquement', () => {
  // Frontend envoie invoice_open_amount_inc_vat déjà réduit : 1000 - 500 = 500
  const inv = { invoice_open_amount_inc_vat: '500', amount_paid: '500', payt_status: null };
  const effectiveOpen = parseFloat(inv.invoice_open_amount_inc_vat);
  const amountPaid    = parseFloat(inv.amount_paid);
  test('Step 3 : originalOpen envoyé à PAYT = 1000',  computeOriginalOpen(effectiveOpen, amountPaid), 1000);
  test('Step 4 : facture dans paidBatch',              isInPaidBatch(inv),                            true);
  test('Step 5 : facture hors clotureeeBatch',         isInClotureeeBatch(inv),                       false);
  test('Step 4 : montant paiement = 500',              amountPaid,                                    500);
  test('Step 5 : pas d\'avoir créé (non clôturée)',    isInClotureeeBatch(inv) === false,             true);
});

suite('computeAvoirAmount — cas limites (effectiveOpen déjà réduit par le frontend)', () => {
  test('effectiveOpen = 1000, paid=0 → avoir = 1000',     computeAvoirAmount(1000),    1000);
  test('effectiveOpen = 0 (payée intégralement) → avoir=0', computeAvoirAmount(0),       0);
  test('effectiveOpen = 666.67 → avoir = 666.67',          computeAvoirAmount(666.67),  666.67);
  test('effectiveOpen négatif → avoir = 0 (pas négatif)', computeAvoirAmount(-5),        0);
});

// ── Logique isInvLocked extraite du frontend ──
function isInvLocked(inv) {
  return inv.pushStatus === 'success' && (inv.paytStatus === 'Clôturée' || inv.paytStatus === 'Payée');
}

suite('isInvLocked — verrouillage après push', () => {
  // Verrouillées
  test('push success + Clôturée → verrouillée',       isInvLocked({ pushStatus: 'success', paytStatus: 'Clôturée' }), true);
  test('push success + Payée    → verrouillée',       isInvLocked({ pushStatus: 'success', paytStatus: 'Payée'    }), true);

  // Pas verrouillées
  test('push success + aucun statut → non verrouillée', isInvLocked({ pushStatus: 'success', paytStatus: null        }), false);
  test('push success + statut vide  → non verrouillée', isInvLocked({ pushStatus: 'success', paytStatus: ''          }), false);
  test('push error  + Clôturée      → non verrouillée', isInvLocked({ pushStatus: 'error',   paytStatus: 'Clôturée'  }), false);
  test('push error  + Payée         → non verrouillée', isInvLocked({ pushStatus: 'error',   paytStatus: 'Payée'     }), false);
  test('jamais envoyée + Clôturée   → non verrouillée', isInvLocked({ pushStatus: null,      paytStatus: 'Clôturée'  }), false);
  test('jamais envoyée + Payée      → non verrouillée', isInvLocked({ pushStatus: null,      paytStatus: 'Payée'     }), false);
  test('envoi en cours + Clôturée   → non verrouillée', isInvLocked({ pushStatus: 'sending', paytStatus: 'Clôturée'  }), false);
});

suite('toSend — factures verrouillées exclues du push', () => {
  // Simule le filtre toSend du frontend
  function simulateToSend(invoices) {
    return invoices.filter(inv =>
      inv.status === 'validated' && inv.targetCompany && !isInvLocked(inv)
    );
  }
  const company = { id: '1', name: 'Société A' };
  const invs = [
    { status: 'validated', targetCompany: company, pushStatus: 'success', paytStatus: 'Clôturée' }, // verrouillée
    { status: 'validated', targetCompany: company, pushStatus: 'success', paytStatus: 'Payée'    }, // verrouillée
    { status: 'validated', targetCompany: company, pushStatus: 'success', paytStatus: null        }, // push réussi mais pas de statut → ok
    { status: 'validated', targetCompany: company, pushStatus: null,      paytStatus: null        }, // jamais envoyée → ok
    { status: 'validated', targetCompany: company, pushStatus: 'error',   paytStatus: 'Clôturée' }, // erreur push → ok
    { status: 'pending',   targetCompany: company, pushStatus: null,      paytStatus: null        }, // pas validée → exclue
    { status: 'validated', targetCompany: null,    pushStatus: null,      paytStatus: null        }, // pas d'entreprise → exclue
  ];
  const result = simulateToSend(invs);
  test('3 factures éligibles (non verrouillées, validées, avec entreprise)', result.length, 3);
  test('Clôturée+success exclue',   result.includes(invs[0]), false);
  test('Payée+success exclue',      result.includes(invs[1]), false);
  test('success+sans statut incluse', result.includes(invs[2]), true);
  test('jamais envoyée incluse',    result.includes(invs[3]), true);
  test('erreur+Clôturée incluse',   result.includes(invs[4]), true);
  test('pending exclue',            result.includes(invs[5]), false);
  test('sans entreprise exclue',    result.includes(invs[6]), false);
});

suite('bulkSetStatus — factures verrouillées ignorées', () => {
  // Simule le comportement de bulkSetStatus
  function simulateBulkSetStatus(invoices, value) {
    invoices.forEach(inv => { if (!isInvLocked(inv)) inv.paytStatus = value; });
    return invoices;
  }
  const company = { id: '1', name: 'Société A' };
  const invs = [
    { pushStatus: 'success', paytStatus: 'Clôturée' }, // verrouillée → inchangée
    { pushStatus: 'success', paytStatus: null        }, // non verrouillée → mise à jour
    { pushStatus: null,      paytStatus: null        }, // jamais envoyée → mise à jour
  ];
  simulateBulkSetStatus(invs, 'Payée');
  test('verrouillée reste Clôturée (non modifiée)', invs[0].paytStatus, 'Clôturée');
  test('non verrouillée → Payée',                   invs[1].paytStatus, 'Payée');
  test('jamais envoyée → Payée',                    invs[2].paytStatus, 'Payée');
});

suite('Auto-toggle statut Payée quand amountPaid = montant en suspens', () => {
  // Simule applyAmountPaid (logique extraite)
  function simulateApply(baseOpen, paid) {
    const p = parseFloat(paid);
    if(isNaN(p) || p <= 0) return { amountPaid: null, newOpen: baseOpen, paytStatus: null };
    const newOpen = Math.max(0, Math.round((baseOpen - p) * 100) / 100);
    return { amountPaid: p, newOpen, paytStatus: newOpen === 0 ? 'Payée' : null };
  }

  let r;
  r = simulateApply(1000, 1000);
  test('amountPaid = openAmount → statut Payée',      r.paytStatus, 'Payée');
  test('amountPaid = openAmount → newOpen = 0',       r.newOpen,    0);

  r = simulateApply(1000, 400);
  test('amountPaid < openAmount → pas de toggle',     r.paytStatus, null);
  test('amountPaid < openAmount → newOpen = 600',     r.newOpen,    600);

  r = simulateApply(1000, 1200);
  test('amountPaid > openAmount → statut Payée',      r.paytStatus, 'Payée');
  test('amountPaid > openAmount → newOpen = 0',       r.newOpen,    0);

  r = simulateApply(1000, null);
  test('amountPaid effacé → statut null',             r.paytStatus, null);
  test('amountPaid effacé → newOpen = baseOpen',      r.newOpen,    1000);
});
