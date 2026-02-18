const DB_NAME = "infoTrainerDB";
const STORE = "sets";
let db;

function fileToBase64(file){
    return new Promise(resolve=>{

        const img = new Image();
        const reader = new FileReader();

        reader.onload = e=>{
            img.src = e.target.result;
        };

        img.onload = ()=>{

            const canvas = document.createElement("canvas");
            const maxSize = 1200; // ←重要

            let width = img.width;
            let height = img.height;

            if(width > height){
                if(width > maxSize){
                    height *= maxSize / width;
                    width = maxSize;
                }
            }else{
                if(height > maxSize){
                    width *= maxSize / height;
                    height = maxSize;
                }
            }

            canvas.width = width;
            canvas.height = height;

            const ctx = canvas.getContext("2d");
            ctx.drawImage(img,0,0,width,height);

            const compressed = canvas.toDataURL("image/jpeg",0.75);

            resolve(compressed);
        };

        reader.readAsDataURL(file);
    });
}

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
        order: Date.now(),
        defaultSolveCount: 3   // ← 追加（初期値）
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
        selectedProblemIndex = null; // ⭐追加
        renderSet();
    }
}

let selectedProblemIndex = null;

function renderSet(){

    selectedProblemIndex = null;

    app.innerHTML=`
        <div class="card">
            <h2>${currentSet.title}</h2>

            <div style="margin-top:10px; display:flex; align-items:center; gap:8px;">
                <label style="white-space:nowrap;">出題数：</label>
                <input id="solveCount"
                       type="number"
                       min="1"
                       style="width:80px;"
                       value="${currentSet.defaultSolveCount || 3}"
                       onchange="updateSolveCount()">
            </div>

            <button onclick="startSolve()">解答モード</button>

            <button onclick="addProblem()">＋ 問題追加</button>

            <button class="secondary" onclick="renderHome()">戻る</button>
        </div>

        <div id="gridContainer"></div>
    `;

    renderProblemGrid();
}

function updateSolveCount(){

    const value = Number(document.getElementById("solveCount").value);

    if(!value || value <= 0) return;

    currentSet.defaultSolveCount = value;

    saveSet(currentSet);
}

function renderProblemGrid(){

    const grid = document.getElementById("gridContainer");

    if(!currentSet.problems?.length){
        grid.innerHTML = `<p style="text-align:center;">問題がありません</p>`;
        return;
    }

    grid.innerHTML = `
        <div id="problemGrid" class="problem-grid">
            ${currentSet.problems.map((p,i)=>`

                <button 
                    data-index="${i}"
                    class="${selectedProblemIndex===i?'active':''}"
                    onclick="selectProblem(${i})">
                    ${i+1}
                </button>

            `).join("")}
        </div>
        ${selectedProblemIndex!==null ? buildDetailHTML(selectedProblemIndex) : ""}
    `;

    enableSortable();
}

function enableSortable(){

    const el = document.getElementById("problemGrid");

    Sortable.create(el, {
        animation:150,

        onEnd: function (evt){

            const moved = currentSet.problems.splice(evt.oldIndex,1)[0];
            currentSet.problems.splice(evt.newIndex,0,moved);

            saveSet(currentSet);
            renderProblemGrid();

            if(window.Prism) Prism.highlightAll();
        }
    });
}

function buildDetailHTML(index){

    const p = currentSet.problems[index];
    const level = p.level || 0;

    return `
        <div class="card">
            <div class="problem-header">
                <strong>問題 ${index+1}</strong>
                <div class="level-dot level${level}"></div>
            </div>

            ${p.qText ? `<p style="white-space:pre-wrap;">${p.qText}</p>` : ""}
            ${p.qCode ? `
            <pre class="code-block">
            <code class="language-c">
            ${escapeHtml(p.qCode)}
            </code>
            </pre>
            ` : ""}
            ${p.qImg?.map(img=>`<img src="${img}">`).join("") || ""}

            <button onclick="editProblem(${index})">編集</button>
            <button class="danger" onclick="deleteProblem(${index})">削除</button>
        </div>
    `;
}

function selectProblem(index){

    // 同じのを押したら閉じる
    if(selectedProblemIndex === index){
        selectedProblemIndex = null;
    }else{
        selectedProblemIndex = index;
    }
    
    renderProblemGrid(); // active更新

    const p = currentSet.problems[index];
    const level = p.level || 0;

    const detail = document.getElementById("detailContainer");

    detail.innerHTML = `
        <div class="card">
            <div class="problem-header">
                <strong>問題 ${index+1}</strong>
                <div class="level-dot level${level}"></div>
            </div>

            ${p.qText ? `<p>${p.qText}</p>` : ""}
            ${p.qCode ? `
            <pre class="code-block">
            <code class="language-c">
            ${escapeHtml(p.qCode)}
            </code>
            </pre>
            ` : ""}
            ${p.qImg?.map(img=>`<img src="${img}">`).join("") || ""}

            <button onclick="editProblem(${index})">編集</button>
            <button class="danger" onclick="deleteProblem(${index})">削除</button>
        </div>
    `;

    if(window.Prism) Prism.highlightAll();

    detail.scrollIntoView({behavior:"smooth"});
}

function editProblem(index){

    tempQ = [];
    tempA = [];

    const p = currentSet.problems[index];

    tempQ = (p.qImg || []).map(file=>({
        file,
        url: file
    }));

    tempA = (p.aImg || []).map(file=>({
        file,
        url: file
    }));

    app.innerHTML=`
    <div class="card">
        <h2>問題</h2>

        <textarea id="qText" rows="4" placeholder="問題文を入力">${p.qText||""}</textarea>

        <textarea id="qCode" class="code-input" placeholder="問題コードを入力">${p.qCode||""}</textarea>

        <button onclick="pickImage('q')">問題画像</button>
        <div id="previewQ"></div>

        <h2>解説</h2>

        <textarea id="aText" rows="8" placeholder="解説文を入力">${p.aText||""}</textarea>

        <textarea id="aCode" class="code-input" placeholder="解説コードを入力">${p.aCode||""}</textarea>

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

    p.qCode = document.getElementById("qCode").value;
    p.aCode = document.getElementById("aCode").value;

    p.qImg = tempQ.map(x=>x.file);
    p.aImg = tempA.map(x=>x.file);

    tempQ = [];
    tempA = [];

    saveSet(currentSet,renderSet);
}

function deleteProblem(i){

    if(!confirm("この問題を削除しますか？")) return;

    currentSet.problems.splice(i,1);
    saveSet(currentSet,renderSet);
}

function removeImage(type,index){

    const list = type==="Q" ? tempQ : tempA;

    list.splice(index,1);

    renderPreview(type);
}

/////////////////////////////////////////////////////
// 問題追加（画像2枚選ぶだけ）
/////////////////////////////////////////////////////

let tempQ=[];
let tempQText="";

function addProblem(){

    tempQ = [];
    tempA = [];

    app.innerHTML=`
    <div class="card">
        <h2>問題</h2>

        <textarea id="qText" rows="4" placeholder="問題文を入力"></textarea>

        <textarea id="qCode" class="code-input" placeholder="問題コードを入力"></textarea>

        <button onclick="pickImage('q')">問題画像</button>
        <div id="previewQ"></div>

        <h2>解説</h2>

        <textarea id="aText" rows="6" placeholder="解説文を入力"></textarea>

        <textarea id="aCode" class="code-input" placeholder="解説コードを入力"></textarea>

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

fileInput.onchange = async e=>{

    const files = Array.from(e.target.files);

    for(const file of files){

        const base64 = await fileToBase64(file);

        const obj = {
            file: base64, // ←文字列！！
            url: base64
        };

        if(picking==='q'){
            tempQ.push(obj);
            renderPreview("Q");
        }else{
            tempA.push(obj);
            renderPreview("A");
        }
    }

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
    
        qImg: tempQ.map(x=>x.file),
        aImg: tempA.map(x=>x.file),
    
        qText: tempQText,
        aText: tempAText,
    
        qCode: document.getElementById("qCode").value,
        aCode: document.getElementById("aCode").value,
    
        level:0
    });

    tempQ=[];
    tempA=[];
    fileInput.value=""; // ←追加（地味に重要）

    saveSet(currentSet,renderSet);
}

let sortableQ = null;
let sortableA = null;

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
    // ⭐ 既存Sortableを破棄
    //////////////////////////////////////////////////

    if(isQ && sortableQ){
        sortableQ.destroy();
    }

    if(!isQ && sortableA){
        sortableA.destroy();
    }

    //////////////////////////////////////////////////
    // ⭐ 新しく1個だけ作る
    //////////////////////////////////////////////////

    const instance = new Sortable(el,{
        animation:180,
        handle:".drag-btn",
        draggable:".img-wrap",
    
        forceFallback:true,
        fallbackOnBody:true,
        fallbackTolerance:3,
    
        direction:"vertical",
    
        ghostClass:"sortable-ghost",
        chosenClass:"sortable-chosen",
    
        delay:0,                 // ← 変更
        delayOnTouchOnly:false,   // ← 変更
        touchStartThreshold:3,
    
        swapThreshold:0.3,
        invertSwap:false,
    
        onEnd:(evt)=>{
            const oldIndex = evt.oldIndex;
            const newIndex = evt.newIndex;
    
            if(oldIndex == null || newIndex == null) return;
            if(oldIndex === newIndex) return;
    
            const moved = list.splice(oldIndex,1)[0];
            list.splice(newIndex,0,moved);
        }
    });
    
    if(isQ){
        sortableQ = instance;
    }else{
        sortableA = instance;
    }
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

function buildWeightedQueue(problems, count){

    count = Math.min(count, problems.length);

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

    let inputValue =
        Number(document.getElementById("solveCount").value)
        || currentSet.defaultSolveCount
        || 3;
    
    // ⭐ここで保存
    currentSet.defaultSolveCount = inputValue;
    saveSet(currentSet);

    queue = buildWeightedQueue(
        currentSet.problems,
        inputValue
    );

    totalCount = queue.length;
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

    app.innerHTML=`
        <div class="card">
            <h3>${solvedCount + 1} / ${totalCount}問</h3>
            <h2>問題</h2>

            ${current.qText ? `<p style="white-space:pre-wrap;">${current.qText}</p>` : ""}
            ${current.qCode ? `
            <pre class="code-block">
            <code class="language-c">
            ${escapeHtml(current.qCode)}
            </code>
            </pre>
            ` : ""}
            ${current.qImg?.map(img=>`<img src="${img}">`).join("") || ""}

            <button id="showBtn" onclick="showAnswer()">解答を見る</button>

            <button class="secondary" onclick="stopSolve()">解答をやめる</button>

            <div id="answerArea"></div>
        </div>
    `;

    if(window.Prism) Prism.highlightAll();
}

function showAnswer(){

    // 解答を見るボタンを消す
    document.getElementById("showBtn").remove();

    // ⭐ ここで一度「やめる」ボタンも削除する
    const stopBtn = document.querySelector("button.secondary");
    if(stopBtn) stopBtn.remove();

    const area = document.getElementById("answerArea");

    area.innerHTML=`
        <h2>解説</h2>
        
        ${current.aText ? `<p style="white-space:pre-wrap;">${current.aText}</p>` : ""}
        ${current.aCode ? `
        <pre class="code-block">
        <code class="language-c">
        ${escapeHtml(current.aCode)}
        </code>
        </pre>
        ` : ""}
        ${current.aImg?.map(img=>`<img src="${img}">`).join("") || ""}

        <div class="level-buttons">
            <button class="level1" onclick="rate(1)">😭苦手</button>
            <button class="level2" onclick="rate(2)">😅微妙</button>
            <button class="level3" onclick="rate(3)">🙂理解</button>
            <button class="level4" onclick="rate(4)">😎完璧</button>
        </div>

        <!-- ⭐ 理解度ボタンの下に再配置 -->
        <button class="secondary" onclick="stopSolve()">解答をやめる</button>
    `;

    if(window.Prism) Prism.highlightAll();

    area.scrollIntoView({behavior:"smooth"});
}

function showResult(){

    if(solvedCount === 0){
        renderSet();
        return;
    }

    const percent = Math.round((correctCount/solvedCount)*100);

    let msg="";

    if(percent>=80) msg="🔥 素晴らしい！";
    else if(percent>=60) msg="👍 良い感じ！";
    else msg="📚 もう一度復習しよう！";

    app.innerHTML=`
        <div class="card center">
            <h2>結果</h2>
            <h1>${correctCount} / ${solvedCount}問 正解</h1>

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

function rate(level){

    current.level = level;

    solvedCount++;
    
    if(level >= 3){
        correctCount++; // ⭐正解カウント
    }

    saveSet(currentSet, ()=>{
        nextProblem();
    });
}

function stopSolve(){

    // 1問も解いていない場合
    if(solvedCount === 0){
        renderSet();  // 結果表示しない
        return;
    }

    showResult();  // 1問以上なら結果表示
}

function escapeHtml(text){
    return text
        .replace(/&/g,"&amp;")
        .replace(/</g,"&lt;")
        .replace(/>/g,"&gt;");
}
