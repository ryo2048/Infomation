const DB_NAME = "infoTrainerDB";
const STORE = "sets";
let db;

/////////////////////////////////////////////////////
// IndexedDB 初期化
/////////////////////////////////////////////////////

const req = indexedDB.open(DB_NAME,1);

req.onupgradeneeded = e=>{
    db = e.target.result;
    db.createObjectStore(STORE,{keyPath:"id"});
}

req.onsuccess = e=>{
    db = e.target.result;
    renderHome();
}

/////////////////////////////////////////////////////
// 共通
/////////////////////////////////////////////////////

function getAll(callback){
    const tx = db.transaction(STORE,"readonly");
    const store = tx.objectStore(STORE);
    const r = store.getAll();
    r.onsuccess = ()=>callback(r.result);
}

function saveSet(set,callback){
    const tx = db.transaction(STORE,"readwrite");
    tx.objectStore(STORE).put(set);
    tx.oncomplete = callback;
}

function deleteSet(id){

    if(!confirm("この問題集を削除しますか？")) return;

    const tx = db.transaction(STORE,"readwrite");
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = renderHome;
}

function uuid(){
    return crypto.randomUUID();
}

const app = document.getElementById("app");
const fileInput = document.getElementById("fileInput");

/////////////////////////////////////////////////////
// ホーム
/////////////////////////////////////////////////////

function renderHome(){

    getAll(sets=>{

        sets.sort((a,b)=>(a.order ?? 0)-(b.order ?? 0));
        
        app.innerHTML = `
        <div class="card center">
            <button onclick="createSet()">＋ 新しい問題集</button>
        </div>

        <div id="setsContainer"></div>
        `;

        const container = document.getElementById("setsContainer");

        sets.forEach(set=>{

            const div=document.createElement("div");
            div.className="card";

            div.innerHTML=`
                <div style="display:flex;align-items:center;gap:10px;">
                    <span class="drag-handle">≡</span>
                    <h2 style="flex:1">${set.title}</h2>

                    <button onclick="renameSet('${set.id}')" class="edit-mini">✏️</button>
                </div>

                <p>問題数: ${set.problems?.length||0}</p>

                <button onclick="openSet('${set.id}')">開く</button>
                <button class="danger" onclick="deleteSet('${set.id}')">削除</button>
            `;

            container.appendChild(div);
        });

        //////////////////////////////////////////////////
        // ⭐ Sortable 起動（超重要）
        //////////////////////////////////////////////////

        new Sortable(container,{
            animation:180,
            ghostClass:"sortable-ghost",
            handle:".drag-handle",

            onEnd:(evt)=>{

                const moved = sets.splice(evt.oldIndex,1)[0];
                sets.splice(evt.newIndex,0,moved);
            
                const tx = db.transaction(STORE,"readwrite");
                const store = tx.objectStore(STORE);
            
                // ⭐順番を再割り当て！！
                sets.forEach((set,i)=>{
                    set.order = i;
                    store.put(set);
                });
            }
        });

    })
}

function renameSet(id){

    const tx=db.transaction(STORE,"readonly");
    const store=tx.objectStore(STORE);
    const r=store.get(id);

    r.onsuccess=()=>{

        const set=r.result;

        const newName = prompt("新しい名前",set.title);

        if(!newName) return;

        set.title=newName;

        saveSet(set,renderHome);
    }
}

function createSet(){

    app.innerHTML=`
    <div class="card">
        <h2>問題集の名前</h2>
        <input id="setTitle" placeholder="例: アルゴリズム">
        <button onclick="saveNewSet()">作成</button>
        <button class="secondary" onclick="renderHome()">戻る</button>
    </div>
    `;
}

function saveNewSet(){
    const title=document.getElementById("setTitle").value;
    if(!title) return;

    const set={
        id:uuid(),
        title,
        problems:[],
        order: Date.now()
    }

    saveSet(set,renderHome);
}

/////////////////////////////////////////////////////
// 問題集
/////////////////////////////////////////////////////

let currentSet;

function openSet(id){

    const tx=db.transaction(STORE,"readonly");
    const store=tx.objectStore(STORE);
    const r=store.get(id);

    r.onsuccess=()=>{
        currentSet=r.result;
        renderSet();
    }
}

function renderSet(){

    app.innerHTML=`
        <div class="card">
            <h2>${currentSet.title}</h2>
            <button onclick="startSolve()">解答モード</button>
            <button onclick="addProblem()">＋ 問題追加</button>
            <button class="secondary" onclick="renderHome()">戻る</button>
        </div>
    `;

    currentSet.problems?.forEach((p,i)=>{

        const div=document.createElement("div");
        div.className="card";

        const level = p.level || 0;

        div.innerHTML=`
            <div class="problem-header">
                <strong>問題 ${i+1}</strong>
                <div class="level-dot level${level}"></div>
            </div>

            ${p.qText ? `<p>${p.qText}</p>` : ""}
            ${p.qImg?.map(img=>`<img src="${URL.createObjectURL(img)}">`).join("") || ""}
            <button onclick="editProblem(${i})">編集</button>
            <button class="danger" onclick="deleteProblem(${i})">削除</button>
        `;

        app.appendChild(div);
    })
}

function editProblem(index){

    const p = currentSet.problems[index];

    tempQ = (p.qImg || []).map(file=>({
        file,
        url:URL.createObjectURL(file)
    }));

    tempA = (p.aImg || []).map(file=>({
        file,
        url:URL.createObjectURL(file)
    }));

    app.innerHTML=`
    <div class="card">
        <h2>問題編集</h2>

        <textarea id="qText" rows="4">${p.qText||""}</textarea>

        <button onclick="pickImage('q')">問題画像</button>
        <div id="previewQ"></div>

        <h2>解説</h2>

        <textarea id="aText" rows="8">${p.aText||""}</textarea>

        <button onclick="pickImage('a')">解説画像</button>
        <div id="previewA"></div>

        <button onclick="updateProblem(${index})">保存</button>
        <button class="secondary" onclick="renderSet()">戻る</button>
    </div>
    `;

    renderPreview("Q");
    renderPreview("A");
}

function updateProblem(index){

    const p = currentSet.problems[index];

    p.qText = document.getElementById("qText").value;
    p.aText = document.getElementById("aText").value;

    p.qImg = tempQ.map(x=>x.file);
    p.aImg = tempA.map(x=>x.file);

    saveSet(currentSet,renderSet);
}

function deleteProblem(i){

    if(!confirm("この問題を削除しますか？")) return;

    currentSet.problems.splice(i,1);
    saveSet(currentSet,renderSet);
}

function removeImage(type,index){

    const list = type==="Q" ? tempQ : tempA;

    // メモリ解放（地味に重要）
    URL.revokeObjectURL(list[index].url);

    list.splice(index,1);

    renderPreview(type);
}

/////////////////////////////////////////////////////
// 問題追加（画像2枚選ぶだけ）
/////////////////////////////////////////////////////

let tempQ=[];
let tempQText="";

function addProblem(){

    app.innerHTML=`
    <div class="card">
        <h2>問題</h2>

        <textarea id="qText" rows="4" placeholder="問題文"></textarea>

        <button onclick="pickImage('q')">問題画像</button>
        <div id="previewQ"></div>

        <h2>解説</h2>

        <textarea id="aText" rows="8" placeholder="解説・コード"></textarea>

        <button onclick="pickImage('a')">解説画像</button>
        <div id="previewA"></div>

        <button onclick="saveProblem()">保存</button>
        <button class="secondary" onclick="renderSet()">戻る</button>
    </div>
    `;
}

let picking;

function pickImage(type){
    picking=type;
    fileInput.click();
}

fileInput.onchange = e=>{

    const files = Array.from(e.target.files);

    files.forEach(file=>{

        // ⭐Blobのまま保存！！
        const blobURL = URL.createObjectURL(file);

        if(picking==='q'){
            tempQ.push({
                file:file,
                url:blobURL
            });
            renderPreview("Q");
        }else{
            tempA.push({
                file:file,
                url:blobURL
            });
            renderPreview("A");
        }

    });

    fileInput.value="";
}

let tempA=[];
let tempAText="";

function saveProblem(){

    tempQText = document.getElementById("qText").value;
    tempAText = document.getElementById("aText").value;

    if(tempQ.length===0 && !tempQText){
        alert("問題は画像か文字を入れてください");
        return;
    }

    currentSet.problems.push({

        // ⭐Blobだけ保存
        qImg: tempQ.map(x=>x.file),
        aImg: tempA.map(x=>x.file),

        qText: tempQText,
        aText: tempAText,
        level:0
    });

    tempQ=[];
    tempA=[];

    saveSet(currentSet,renderSet);
}

function renderPreview(type){

    const isQ = type==="Q";
    const list = isQ ? tempQ : tempA;
    const el = document.getElementById(isQ ? "previewQ":"previewA");

    el.innerHTML = list.map((img,i)=>`
        <div class="img-wrap">
            <button class="img-btn drag-btn">≡</button>

            <img src="${img.url}">
            
            <button 
                class="img-btn delete-btn"
                onclick="removeImage('${type}',${i})">
                ×
            </button>
        </div>
    `).join("");

    //////////////////////////////////////////////////
    // ⭐画像並び替え（プロ仕様）
    //////////////////////////////////////////////////

    new Sortable(el,{
        animation:180,
        handle:".drag-btn",

        onEnd:(evt)=>{
            const moved = list.splice(evt.oldIndex,1)[0];
            list.splice(evt.newIndex,0,moved);
        }
    });
}

/////////////////////////////////////////////////////
// 解答モード
/////////////////////////////////////////////////////

let queue=[];
let current;

let totalCount = 0;   // ←追加
let solvedCount = 0;  // ←追加
let correctCount = 0; // ←追加

function shuffle(array){
    for(let i=array.length-1;i>0;i--){
        const j=Math.floor(Math.random()*(i+1));
        [array[i],array[j]]=[array[j],array[i]];
    }
    return array; // ←追加
}

function buildWeightedQueue(problems){

    const count = Math.min(3, problems.length);

    // コピー（元配列を壊さない）
    let pool = [...problems];
    let selected = [];

    function getWeight(level){
        switch(level){
            case 1: return 5; // 超苦手
            case 2: return 4;
            case 3: return 2;
            case 4: return 1; // 得意
            default: return 3; // 未評価
        }
    }

    for(let i=0;i<count;i++){

        // 重み合計
        let total = pool.reduce((sum,p)=>sum+getWeight(p.level),0);

        // ルーレット抽選
        let r = Math.random()*total;

        let cumulative=0;
        let chosenIndex=0;

        for(let j=0;j<pool.length;j++){
            cumulative += getWeight(pool[j].level);

            if(r <= cumulative){
                chosenIndex=j;
                break;
            }
        }

        selected.push(pool[chosenIndex]);

        // ⭐ 超重要：削除（重複防止）
        pool.splice(chosenIndex,1);
    }

    return shuffle(selected);
}

function startSolve(){

    if(!currentSet.problems.length){
        alert("問題がありません");
        return;
    }

    queue = buildWeightedQueue(currentSet.problems);

    totalCount = queue.length; // ⭐重要
    solvedCount = 0;
    correctCount = 0;

    nextProblem();
}

function nextProblem(){

    if(queue.length===0){
        showResult();
        return;
    }

    current=queue.shift();
    solvedCount++;

    app.innerHTML=`
        <div class="card">
            <h3>${solvedCount} / ${totalCount}問</h3>
            <h2>問題</h2>

            ${current.qText ? `<p>${current.qText}</p>` : ""}
            ${current.qImg?.map(img=>`<img src="${URL.createObjectURL(img)}">`).join("") || ""}

            <button id="showBtn" onclick="showAnswer()">解答を見る</button>

            <div id="answerArea"></div>
        </div>
    `;
}

function showAnswer(){

    document.getElementById("showBtn").style.display="none";

    const area = document.getElementById("answerArea");

    area.innerHTML=`
        <h2>解説</h2>
        
        ${current.aText ? `<pre><code class="language-c">${escapeHtml(current.aText)}</code></pre>` : ""}

        ${current.aImg?.map(img=>`<img src="${URL.createObjectURL(img)}">`).join("") || ""}

        <div class="level-buttons">
            <button class="level1" onclick="rate(1)">😭苦手</button>
            <button class="level2" onclick="rate(2)">😅微妙</button>
            <button class="level3" onclick="rate(3)">🙂理解</button>
            <button class="level4" onclick="rate(4)">😎完璧</button>
        </div>
    `;
    
    Prism.highlightElement(area.querySelector("code"));

    area.scrollIntoView({behavior:"smooth"});
}

function showResult(){

    const percent = Math.round((correctCount/totalCount)*100);

    let msg="";

    if(percent>=80) msg="🔥 素晴らしい！";
    else if(percent>=60) msg="👍 良い感じ！";
    else msg="📚 もう一度復習しよう！";

    app.innerHTML=`
        <div class="card center">
            <h2>結果</h2>
            <h1>${correctCount} / ${totalCount}問 正解</h1>

           <div class="circle">

                <svg width="180" height="180">
                    <circle class="bg" cx="90" cy="90" r="70"></circle>
                    <circle class="progress" cx="90" cy="90" r="70"></circle>
                </svg>

                <div class="inner">${percent}%</div>

            </div>

            <h2>${msg}</h2>   <!-- ←⭐ここ！！ -->

            <button onclick="renderSet()">問題集に戻る</button>
        </div>
    `;

    setTimeout(()=>{

        const circle = document.querySelector(".progress");

        const radius = 70;
        const circumference = 2 * Math.PI * radius;

        const offset = circumference - (percent/100)*circumference;

        circle.style.strokeDashoffset = offset;

    },200);

}

function escapeHtml(text){
    return text
        .replace(/&/g,"&amp;")
        .replace(/</g,"&lt;")
        .replace(/>/g,"&gt;");
}

function rate(level){

    current.level = level;

    if(level >= 3){
        correctCount++; // ⭐正解カウント
    }

    saveSet(currentSet, ()=>{
        nextProblem();
    });
}

document.addEventListener("keydown", e=>{
    if(e.target.tagName==="TEXTAREA" && e.key==="Tab"){
        e.preventDefault();

        const textarea = e.target;
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;

        // 複数行対応
        const value = textarea.value;
        const selected = value.slice(start, end);
        const indented = selected.replace(/^/gm, "    ");

        textarea.value =
            value.substring(0,start)
            + indented
            + value.substring(end);

        textarea.selectionStart = start;
        textarea.selectionEnd = start + indented.length;
    }
});
