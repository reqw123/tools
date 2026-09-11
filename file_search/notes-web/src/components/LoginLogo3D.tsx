import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

/**
 * 登入畫面的 3D logo——host 個人品牌用（目前放的是元培大學的 3D logo 模型，
 * Meshy AI 生成）。素材放在 `public/branding/yuanpei/`：
 *   - `model.glb`——**原本是 30MB 的 FBX**，離線轉檔過兩層才變成現在的
 *     5MB：① FBX 裡有 ~18MB 是內嵌貼圖，跟旁邊那三張分開匯出的原始貼圖完全
 *     重複（這個元件的材質是自己指定的，根本不會用到 FBX 內嵌那份，內嵌只是
 *     死重量）；② 剩下的網格本身沒有退化——880,785 個頂點、293,595 個三角形
 *     且完全沒有索引共用（典型 AI 生成的原始網格，沒做拓樸優化），用
 *     three.js 的 `SimplifyModifier`（meshoptimizer 的 WASM 簡化器，帶 UV／
 *     法線感知的邊塌陷）焊接＋減面到約 125,686 頂點／82,962 三角形——受限於
 *     這個模型的 UV 拆件方式（很多獨立小拼塊，跟貼圖本身是拼貼碎片同一個
 *     原因），已經是這個網格在不撕裂貼圖映射前提下能簡化到的實際下限，
 *     不是隨便挑的數字（測過要求減到只剩 500 頂點，結果還是停在同一個數字）。
 *     沒有 Blender，這整套轉檔＋簡化是直接在 Node 裡跑 three.js 的
 *     FBXLoader／SimplifyModifier／GLTFExporter 做的，一次性的離線步驟，
 *     跟這個元件本身的執行期無關。
 *   - `basecolor.webp` / `normal.webp` / `metallic-roughness.webp`——原本
 *     2048~4096px 的 PNG（單張最大到 7MB）用 sharp 壓成 512~768px 的 WebP
 *     （三張加起來不到 1MB），metallic-roughness 是合併貼圖（glTF 慣例：
 *     G=roughness、B=metalness，Three.js 的 metalnessMap/roughnessMap 可以
 *     指到同一張、各自只取自己要的 channel，不用分兩張存）。
 *   五個檔案加起來從原本的 ~30MB 降到 **~5.6MB**（模型／貼圖都不吃 FBX 內嵌
 *   材質、也不吃 FBXLoader 相對重的二進位解析器——改用輕量很多的 glTF 二進位
 *   格式＋標準 `GLTFLoader`）。
 *
 * 這整包被 `.gitignore` 排除——是這台機器 host 自己的東西，不是牆的功能，
 * 不該進版控／不該讓其他人 clone 這個專案時也背了這幾 MB。
 *
 * 模型跟三張貼圖**平行載入**（`Promise.all`），不是模型載完才開始抓貼圖、
 * 或反過來——省下原本序列載入白白浪費的等待時間。
 *
 * **只在 `<PasswordGate>` 判斷 `share.loginLogo3d===true` 時才會被 mount**——
 * 這裡沒有自己的開關判斷，關掉時父層根本不會 render 這個元件，不會發出任何
 * 下載請求、不會建立 WebGL context。卸載時（父層條件變 false，或使用者離開
 * 登入畫面）明確 dispose 掉 geometry／material／texture／renderer，不留著
 * 等瀏覽器自己回收——這是使用者明確要求的「不載入時完全釋放資源」。
 */
const MODEL_URL = '/branding/yuanpei/model.glb'
const TEX_BASE = '/branding/yuanpei/basecolor.webp'
const TEX_NORMAL = '/branding/yuanpei/normal.webp'
const TEX_METAL_ROUGH = '/branding/yuanpei/metallic-roughness.webp'
const ROTATE_SPEED = 0.5 // rad/s，緩慢自轉展示用，不是互動模型

type Status = 'loading' | 'ready' | 'error'

export function LoginLogo3D() {
  const mountRef = useRef<HTMLDivElement>(null)
  const [status, setStatus] = useState<Status>('loading')

  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return
    let disposed = false
    let raf = 0

    const width = mount.clientWidth || 220
    const height = mount.clientHeight || 220

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    renderer.setSize(width, height)
    mount.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(35, width / height, 0.1, 100)
    camera.position.set(0, 0.35, 3.2)

    scene.add(new THREE.AmbientLight(0xffffff, 0.9))
    const key = new THREE.DirectionalLight(0xffffff, 1.7)
    key.position.set(2, 3, 4)
    scene.add(key)
    const rim = new THREE.DirectionalLight(0x9fc7ff, 0.65)
    rim.position.set(-3, -1, -2)
    scene.add(rim)

    let model: THREE.Object3D | null = null
    const disposables: { dispose(): void }[] = []
    const texLoader = new THREE.TextureLoader()
    const loadTexture = (url: string) =>
      new Promise<THREE.Texture>((resolve, reject) => texLoader.load(url, resolve, undefined, reject))
    const loadModel = () =>
      new Promise<THREE.Group>((resolve, reject) => {
        new GLTFLoader().load(MODEL_URL, (gltf) => resolve(gltf.scene), undefined, reject)
      })
    const disposeGeometries = (obj: THREE.Object3D) =>
      obj.traverse((child) => {
        const mesh = child as THREE.Mesh
        if (mesh.isMesh) mesh.geometry.dispose()
      })

    // 模型跟三張貼圖同時發出去，不要序列等——四個請求本來就互不相依。用
    // allSettled 而不是 all：如果進牆（元件卸載，disposed=true）發生在
    // 「部分資源已經載完、部分還在飛」的那個空檔，Promise.all 只要其中一個
    // reject 就整組短路 reject，那些「已經成功載完」的資源（例如模型已經
    // 到了，某張貼圖還沒到）會直接從 catch 那層消失、永遠不會被 dispose
    // 到——GPU 貼圖/幾何就這樣洩漏掉了。allSettled 保證四個結果都拿得到，
    // 不管彼此成功失敗，才能在同一個地方一次判斷「這批要不要用」，該丟的
    // 全部丟乾淨。
    Promise.allSettled([loadModel(), loadTexture(TEX_BASE), loadTexture(TEX_NORMAL), loadTexture(TEX_METAL_ROUGH)]).then(
      ([modelR, baseR, normalR, mrR]) => {
        const gltfScene = modelR.status === 'fulfilled' ? modelR.value : null
        const baseTex = baseR.status === 'fulfilled' ? baseR.value : null
        const normalTex = normalR.status === 'fulfilled' ? normalR.value : null
        const mrTex = mrR.status === 'fulfilled' ? mrR.value : null

        // 卸載了，或任何一個資源真的載入失敗——把「已經拿到手」的那幾個
        // 立刻 dispose 掉，不留半殘的資源在記憶體裡，也不繼續往下組場景。
        if (disposed || !gltfScene || !baseTex || !normalTex || !mrTex) {
          if (gltfScene) disposeGeometries(gltfScene)
          baseTex?.dispose()
          normalTex?.dispose()
          mrTex?.dispose()
          if (!disposed) setStatus('error')
          return
        }

        baseTex.colorSpace = THREE.SRGBColorSpace
        disposables.push(baseTex, normalTex, mrTex)

        const material = new THREE.MeshStandardMaterial({
          map: baseTex,
          normalMap: normalTex,
          metalnessMap: mrTex,
          roughnessMap: mrTex,
          metalness: 1,
          roughness: 1,
        })
        disposables.push(material)

        gltfScene.traverse((child) => {
          const mesh = child as THREE.Mesh
          if (!mesh.isMesh) return
          mesh.material = material
          disposables.push(mesh.geometry)
        })

        // 自動置中＋縮放——原始模型尺寸/原點不可預期，量出包圍盒自己算，
        // 不假設模型乾淨地擺在原點、尺寸落在合理範圍。
        const box = new THREE.Box3().setFromObject(gltfScene)
        const size = box.getSize(new THREE.Vector3())
        const center = box.getCenter(new THREE.Vector3())
        const maxDim = Math.max(size.x, size.y, size.z) || 1
        const scale = 1.8 / maxDim
        gltfScene.scale.setScalar(scale)
        gltfScene.position.sub(center.multiplyScalar(scale))

        model = gltfScene
        scene.add(gltfScene)
        setStatus('ready')
      },
    )

    const clock = new THREE.Clock()
    const animate = () => {
      raf = requestAnimationFrame(animate)
      if (model) model.rotation.y += clock.getDelta() * ROTATE_SPEED
      renderer.render(scene, camera)
    }
    animate()

    const onResize = () => {
      const w = mount.clientWidth || width
      const h = mount.clientHeight || height
      renderer.setSize(w, h)
      camera.aspect = w / h
      camera.updateProjectionMatrix()
    }
    const ro = new ResizeObserver(onResize)
    ro.observe(mount)

    return () => {
      disposed = true
      cancelAnimationFrame(raf)
      ro.disconnect()
      for (const d of disposables) d.dispose()
      renderer.dispose()
      renderer.forceContextLoss() // 立刻釋放 GPU context，不等瀏覽器自己回收
      if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement)
    }
  }, [])

  return (
    <div className="login-logo-3d">
      <div ref={mountRef} className="login-logo-3d-canvas" aria-hidden />
      {status === 'loading' && <p className="login-logo-3d-hint dim mono">// 載入 3D logo…</p>}
      {status === 'error' && <p className="login-logo-3d-hint dim mono">// logo 讀取失敗</p>}
    </div>
  )
}
