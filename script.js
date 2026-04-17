let fileInput;

function base64ToBlob(base64){
    const arr = base64.split(",");
    const mime = arr[0].match(/:(.*?);/)[1];
    const bstr = atob(arr[1]);
    let n = bstr.length;
    const u8arr = new Uint8Array(n);
    while(n--){
        u8arr[n] = bstr.charCodeAt(n);
    }
    return new Blob([u8arr], { type: mime });
}

async function migrateBase64Images(){
    console.log("🔥 migrateBase64Images start");

    const { data: sets, error } =
        await sb.from("sets")
        .select(`
            *,
            problems (
                *,
                images (*)
            )
        `);

    if(error){
        console.error("migrate error:", error);
        return;
    }

    for(const set of sets){

        let changed = false;

        for(const p of set.problems){

            // ====== Q画像 ======
            for(let i=0;i<p.images.length;i++){

                const img = p.images[i];

                if(img.image_url.startsWith("data:")){

                    const blob = base64ToBlob(img.image_url);

                    const fileName =
                        `${p.id}/${crypto.randomUUID()}.jpg`;

                    await sb.storage
                        .from("problem-images")
                        .upload(fileName, blob);

                    const { data } =
                        sb.storage
                        .from("problem-images")
                        .getPublicUrl(fileName);

                    await sb.from("images")
                        .update({ image_url: data.publicUrl })
                        .eq("id", img.id);

                    changed = true;
                }
            }
        }

        if(changed){
            console.log("修正:", set.title);
        }
    }

    console.log("🎉 Base64完全移行完了");
}

/////////////////////////////////////
// 🔥 画像圧縮関数（←ここに置く）
/////////////////////////////////////
function compressImage(file){
    return new Promise(resolve=>{

        const img = new Image();
        const url = URL.createObjectURL(file);

        img.onload = ()=>{

            const canvas = document.createElement("canvas");
            const maxSize = 1000;

            let width = img.width;
            let height = img.height;

            if(width > height && width > maxSize){
                height *= maxSize / width;
                width = maxSize;
            }else if(height > maxSize){
                width *= maxSize / height;
                height = maxSize;
            }

            canvas.width = width;
            canvas.height = height;

            const ctx = canvas.getContext("2d");
            ctx.drawImage(img,0,0,width,height);

            canvas.toBlob(blob=>{
                resolve(blob);
                URL.revokeObjectURL(url);
            },"image/jpeg",0.5);
        };

        img.src = url;
    });
}

/////////////////////////////////////
// 🔥 画像アップロード
/////////////////////////////////////
async function uploadImage(file, problemId){

    const compressed = await compressImage(file);

    const fileName = `${problemId}/${crypto.randomUUID()}.jpg`;

    const { error } = await sb.storage
        .from("problem-images")
        .upload(fileName, compressed, {
            cacheControl: "3600",
            upsert: true
        });

    if(error){
        console.error("upload error:", error);
        alert("画像アップロード失敗");
        return null;
    }

    const { data: publicData } = sb.storage
        .from("problem-images")
        .getPublicUrl(fileName);

    return publicData.publicUrl;
}

/////////////////////////////////////////////////////
// 🔥 クラウド → ローカル同期
/////////////////////////////////////////////////////


/////////////////////////////////////////////////////
// 共通
/////////////////////////////////////////////////////

async function saveSetCloud(set){

    try{

        // =========================
        // ① sets（確実に確定させる）
        // =========================
        const { data: insertedSet, error: setError } =
            await sb.from("sets")
                .upsert({
                    id: set.id,
                    title: set.title,
                    order_index: set.order ?? 0,
                    default_solve_count: set.defaultSolveCount ?? 3
                })
                .select()
                .single();
        
        if(setError){
            console.error("sets error:", setError);
            alert("sets保存エラー");
            return;
        }

        // =========================
        // ② problems payload 作成（🔥追加）
        // =========================
       const problemsPayload = set.problems.map((p, i)=>{

            if(!p.id){
                p.id = crypto.randomUUID();  // ← ここ追加（超重要）
            }
        
            return {
                id: p.id,
                set_id: set.id,
                q_text: p.qText,
                a_text: p.aText,
                level: p.level ?? 0,
                order_index: i
            };
        });
        
        // =========================
        // ③ 不要problem削除（完全修正版）
        // =========================

        // 既存problem取得
        const { data: existingProblems } = await sb
            .from("problems")
            .select("id")
            .eq("set_id", set.id);

        const existingIds = existingProblems?.map(p=>p.id) || [];
        const currentIds = set.problems.map(p=>p.id);

        // 削除対象
        const idsToDelete = existingIds.filter(
            id => !currentIds.includes(id)
        );

        if(idsToDelete.length){

            // 🔥 ① まずそのproblemに紐づく画像URL取得
            const { data: imgs } = await sb
                .from("images")
                .select("image_url")
                .in("problem_id", idsToDelete);

            // 🔥 ② Storage削除
            if(imgs?.length){
                const paths = imgs.map(img=>{
                    return img.image_url.split("/problem-images/")[1];
                });

                await sb.storage
                    .from("problem-images")
                    .remove(paths);
            }

            // 🔥 ③ imagesテーブル削除
            await sb.from("images")
                .delete()
                .in("problem_id", idsToDelete);

            // 🔥 ④ problems削除
            const { error } = await sb.from("problems")
                .delete()
                .in("id", idsToDelete);

            if(error){
                console.error("delete error:", error);
            }
        }

        // =========================
        // ④ problems保存
        // =========================
        if(problemsPayload.length){
        
            const { error } =
                await sb.from("problems")
                    .upsert(problemsPayload);
        
            if(error){
                alert(
                    "message: " + error.message + "\n\n" +
                    "details: " + error.details + "\n\n" +
                    "hint: " + error.hint + "\n\n" +
                    "code: " + error.code
                );
                return;
            }
        }
        
        // =========================
        // ⑤ images 再構築（安全版）
        // =========================

        const problemIds = set.problems.map(p=>p.id);

        if(problemIds.length){
            // ② imagesテーブルのみ削除
            await sb.from("images")
                .delete()
                .in("problem_id", problemIds);
        }

        let imagePayload = [];

        set.problems.forEach(p=>{

            (p.qImg||[]).forEach((url,i)=>{
                imagePayload.push({
                    id: crypto.randomUUID(),
                    problem_id: p.id,
                    type:"q",
                    image_url:url,
                    order_index:i
                });
            });

            (p.aImg||[]).forEach((url,i)=>{
                imagePayload.push({
                    id: crypto.randomUUID(),
                    problem_id: p.id,
                    type:"a",
                    image_url:url,
                    order_index:i
                });
            });
        });

        if(imagePayload.length){

            const { error: imgError } =
                await sb.from("images").insert(imagePayload);
        
            if(imgError){
                console.error("images error:", imgError);
                alert("images保存エラー");
                return;
            }
        }

        console.log("Cloud save complete");

    }catch(err){
        console.error(err);
        alert("保存に失敗しました");
    }
}

async function saveSet(set, callback){

    await saveSetCloud(set);

    if(callback) callback();
}

async function deleteSet(id){

    if(!confirm("削除しますか？")) return;

    // ① problem取得
    const { data: problems } =
        await sb.from("problems")
            .select("id")
            .eq("set_id", id);

    const problemIds = problems?.map(p=>p.id) || [];

    // ② 画像URL取得
    if(problemIds.length){

        const { data: imgs } =
            await sb.from("images")
                .select("image_url")
                .in("problem_id", problemIds);

        if(imgs?.length){

            const paths = imgs.map(img=>{
                return img.image_url.split("/problem-images/")[1];
            });

            await sb.storage
                .from("problem-images")
                .remove(paths);
        }

        // imagesテーブル削除
        await sb.from("images")
            .delete()
            .in("problem_id", problemIds);
    }

    // problems削除
    await sb.from("problems")
        .delete()
        .eq("set_id", id);

    // sets削除
    await sb.from("sets")
        .delete()
        .eq("id", id);

    renderHome();
}

function uuid(){
    return crypto.randomUUID();
}

const app = document.getElementById("app");

/////////////////////////////////////////////////////
// ホーム
/////////////////////////////////////////////////////

async function renderHome(){

    const { data: sets, error } =
        await sb.from("sets")
        .select(`
            *,
            problems ( id )
        `)
        .order("order_index",{ascending:true});

    if(error){
        alert("読み込み失敗");
        console.error(error);
        return;
    }

    app.innerHTML = `
        <div class="card center">
            <button onclick="createSet()">＋ 新しい問題集</button>
        </div>
        <div id="setsContainer"></div>
    `;

    const container = document.getElementById("setsContainer");

    sets.forEach(set=>{

        const problemCount = set.problems?.length || 0;

        const div=document.createElement("div");
        div.className="card";

        div.innerHTML=`
            <div style="display:flex;align-items:center;gap:10px;">
                <span class="drag-handle">≡</span>
                <h2 style="flex:1">${set.title}</h2>
                <button onclick="renameSet('${set.id}')" class="edit-mini">✏️</button>
            </div>

            <p>問題数：${problemCount}</p>

            <button onclick="openSet('${set.id}')">開く</button>
            <button class="danger" onclick="deleteSet('${set.id}')">削除</button>
        `;

        container.appendChild(div);
    });

    new Sortable(container,{
        animation:180,
        ghostClass:"sortable-ghost",
        handle:".drag-handle",

        onEnd: async (evt)=>{

            const moved = sets.splice(evt.oldIndex,1)[0];
            sets.splice(evt.newIndex,0,moved);

            for(let i=0;i<sets.length;i++){
                await sb.from("sets")
                    .update({ order_index:i })
                    .eq("id",sets[i].id);
            }
        }
    });
}

async function renameSet(id){

    const newName = prompt("新しい名前");

    if(!newName) return;

    await sb.from("sets")
        .update({ title:newName })
        .eq("id",id);

    renderHome();
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

async function openSet(id){

    const { data: setData, error } = await sb
        .from("sets")
        .select(`
            *,
            problems (
                *,
                images (*)
            )
        `)
        .eq("id", id)
        .single();

    if(error){
        console.error(error);
        alert("読み込み失敗");
        return;
    }

    const localSet = {
        id: setData.id,
        title: setData.title,
        problems: [],
        order: setData.order_index ?? 0,
        defaultSolveCount: setData.default_solve_count ?? 3
    };

    (setData.problems || [])
        .sort((a,b)=>a.order_index-b.order_index)
        .forEach(p=>{

            const qImg=[];
            const aImg=[];

            (p.images||[])
                .sort((a,b)=>a.order_index-b.order_index)
                .forEach(img=>{
                    if(img.type==="q") qImg.push(img.image_url);
                    if(img.type==="a") aImg.push(img.image_url);
                });

            localSet.problems.push({
                id:p.id,
                qText:p.q_text,
                aText:p.a_text,
                level:p.level ?? 0,
                qImg,
                aImg
            });
        });

    currentSet = localSet;
    selectedProblemIndex = null;
    renderSet();
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

        delay: 300,                 // ⭐ 200 → 300〜350に上げる
        delayOnTouchOnly: true,

        touchStartThreshold: 10,    // ⭐ 5 → 10（重要）
        fallbackTolerance: 12,      // ⭐ 8 → 12（重要）

        forceFallback: true,        // ⭐ 追加（超効く）

        onEnd: function (evt){

            const moved = currentSet.problems.splice(evt.oldIndex,1)[0];
            currentSet.problems.splice(evt.newIndex,0,moved);

            saveSet(currentSet);
            renderProblemGrid();
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
}

function editProblem(index){

    tempQ = [];
    tempA = [];

    const p = currentSet.problems[index];
    editingProblemId = p.id; // 🔥追加

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
        <h2>問題を編集</h2>

        <textarea id="qText" rows="4" placeholder="問題文を入力">${p.qText||""}</textarea>

        <button onclick="pickImage('q')">問題画像</button>
        <div id="previewQ"></div>

        <h2>解説を編集</h2>

        <textarea id="aText" rows="8" placeholder="解説文を入力">${p.aText||""}</textarea>

        <button onclick="pickImage('a')">解説画像</button>
        <div id="previewA"></div>

        <button onclick="updateProblem(${index})">保存</button>
        <button class="secondary" onclick="renderSet()">戻る</button>
    </div>
    `;

    renderPreview("Q");
    renderPreview("A");
}

async function updateProblem(index){

    const p = currentSet.problems[index];

    // 🔥 Storage 削除: tempQ/tempA に存在しない画像を削除
    const oldImgs = [...(p.qImg||[]), ...(p.aImg||[])];
    const newImgs = [...tempQ.map(x=>x.file), ...tempA.map(x=>x.file)];
    const toDelete = oldImgs.filter(url => !newImgs.includes(url));

    if(toDelete.length){
        const paths = toDelete.map(url => url.split("/problem-images/")[1]);
        await sb.storage.from("problem-images").remove(paths);
    }

    // 配列更新
    p.qText = document.getElementById("qText").value;
    p.aText = document.getElementById("aText").value;
    p.qImg = tempQ.map(x=>x.file);
    p.aImg = tempA.map(x=>x.file);

    tempQ = [];
    tempA = [];

    saveSet(currentSet,renderSet);
}

async function deleteProblem(i){

    if(!confirm("この問題を削除しますか？")) return;

    const problem = currentSet.problems[i];

    // 🔥 ① まずStorage削除
    const urls = [
        ...(problem.qImg || []),
        ...(problem.aImg || [])
    ];

    if(urls.length){

        const paths = urls.map(url=>{
            return url.split("/problem-images/")[1];
        });

        await sb.storage
            .from("problem-images")
            .remove(paths);
    }

    // 🔥 ② imagesテーブル削除
    await sb.from("images")
        .delete()
        .eq("problem_id", problem.id);

    // 🔥 ③ problemsテーブル削除
    await sb.from("problems")
        .delete()
        .eq("id", problem.id);

    // 🔥 ④ ローカル配列削除
    currentSet.problems.splice(i,1);

    renderSet();
}

async function deleteImageFromStorage(url){

    const path = url.split("/problem-images/")[1];

    await sb.storage
        .from("problem-images")
        .remove([path]);
}

function removeImage(type,index){
    const list = type==="Q" ? tempQ : tempA;
    const removed = list.splice(index,1)[0];

    // Storage からも削除
    if(removed?.file?.startsWith("https://")){ // 既にアップロード済みなら
        deleteImageFromStorage(removed.file);
    }

    renderPreview(type);
}

/////////////////////////////////////////////////////
// 問題追加（画像2枚選ぶだけ）
/////////////////////////////////////////////////////

let tempQ=[];
let tempQText="";

let editingProblemId = null;

function addProblem(){

    tempQ = [];
    tempA = [];

    editingProblemId = crypto.randomUUID(); // 🔥追加

    app.innerHTML=`
    <div class="card">
        <h2>問題を追加</h2>

        <textarea id="qText" rows="4" placeholder="問題文を入力"></textarea>

        <button onclick="pickImage('q')">問題画像</button>
        <div id="previewQ"></div>

        <h2>解説を追加</h2>

        <textarea id="aText" rows="8" placeholder="解説文を入力"></textarea>

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

let tempA=[];
let tempAText="";

async function saveProblem(){

    tempQText = document.getElementById("qText").value;
    tempAText = document.getElementById("aText").value;

    if(tempQ.length===0 && !tempQText){
        alert("問題は画像か文字を入れてください");
        return;
    }

    // 🔥 アップロード待ち
    const waitUploads = [...tempQ, ...tempA]
        .filter(x => x.uploading);

    if(waitUploads.length){
        alert("画像アップロード中です。少し待ってください。");
        return;
    }

    currentSet.problems.push({
        id: editingProblemId,
        qImg: tempQ.map(x=>x.file),
        aImg: tempA.map(x=>x.file),
        qText: tempQText,
        aText: tempAText,
        level:0
    });

    editingProblemId = null;
    tempQ=[];
    tempA=[];
    fileInput.value="";

    await saveSet(currentSet, renderSet);
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

            <img src="${img.url}" data-index="${i}">
            
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
            ${current.qImg?.map(img=>`<img src="${img}">`).join("") || ""}

            <button id="showBtn" onclick="showAnswer()">解答を見る</button>

            <button class="secondary" onclick="stopSolve()">解答をやめる</button>

            <div id="answerArea"></div>
        </div>
    `;
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

document.addEventListener("DOMContentLoaded",()=>{

    fileInput = document.getElementById("fileInput");

    fileInput.onchange = async e=>{
        
        const currentPicking = picking; // ← これ追加

        const files = Array.from(e.target.files);

        let problemId = editingProblemId || crypto.randomUUID();

        for(const file of files){

            const localUrl = URL.createObjectURL(file);

            const obj = {
                file: file,
                url: localUrl,
                uploading: true
            };

            if(currentPicking === 'q'){
                tempQ.push(obj);
            }else{
                tempA.push(obj);
            }

            renderPreview(picking==="q"?"Q":"A");

            uploadImage(file, problemId)
                .then(remoteUrl => {
            
                    if(!remoteUrl) return;
            
                    obj.file = remoteUrl;
                    obj.uploading = false;
                    obj.url = remoteUrl;
            
                    console.log("upload success:", remoteUrl);
            
                })
                .catch(err=>{
                    console.error("upload crash:", err);
                });
        }

        fileInput.value="";
    };

    renderHome();
});

migrateBase64Images();

//////////////////////////////////////////////
// 🔥 IndexedDB → Supabase 完全移行
//////////////////////////////////////////////

async function migrateIndexedDBToSupabase(){

    return new Promise((resolve,reject)=>{

        const request = indexedDB.open("infoTrainerDB",1);

        request.onerror = ()=>{
            alert("IndexedDBが見つかりません");
            reject();
        };

        request.onsuccess = async (event)=>{

            const db = event.target.result;

            const tx = db.transaction("sets","readonly");
            const store = tx.objectStore("sets");

            const getAllReq = store.getAll();

            getAllReq.onsuccess = async ()=>{

                const localSets = getAllReq.result;

                if(!localSets.length){
                    alert("ローカルデータなし");
                    resolve();
                    return;
                }

                console.log("ローカル件数:", localSets.length);

                for(const set of localSets){

                    console.log("移行中:", set.title);

                    await saveSetCloud(set);
                }

                alert("🎉 IndexedDB → Supabase 移行完了");
                resolve();
            };

            getAllReq.onerror = ()=>{
                alert("読み込み失敗");
                reject();
            };
        };
    });
}

//////////////////////////////////////////////
// 🔥 JSONバックアップ復元
//////////////////////////////////////////////

async function restoreFromBackup(backupData){

    if(!Array.isArray(backupData)){
        alert("バックアップ形式が不正");
        return;
    }

    for(const set of backupData){

        console.log("復元中:", set.title);

        await saveSetCloud(set);
    }

    alert("🎉 復元完了");

    renderHome();
}

async function importBackupFile(file){

    const text = await file.text();
    const data = JSON.parse(text);

    restoreFromBackup(data);
}

document.getElementById("backupInput").onchange = e=>{
    importBackupFile(e.target.files[0]);
};
