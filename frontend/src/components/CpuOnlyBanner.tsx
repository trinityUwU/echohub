import { useEffect, useState } from 'react'
import { getGpuBackend } from '@/api/client'

type GpuBackend = {
  backend: 'cuda' | 'rocm' | 'metal' | 'cpu'
  gpu_name: string | null
  cuda_available: boolean
  reason?: string
}

function InstallInstructions({ gpuName }: { gpuName: string | null }) {
  const isAmd = gpuName?.toLowerCase().includes('amd') || gpuName?.toLowerCase().includes('radeon')
  const isLinux = navigator.userAgent.includes('Linux') || navigator.platform.includes('Linux')
  const isWindows = navigator.userAgent.includes('Windows') || navigator.platform.includes('Win')

  if (isAmd) {
    return (
      <div className="mt-2 space-y-1 text-xs text-yellow-200/70 font-mono">
        <p># Reinstall llama-cpp-python with ROCm support:</p>
        <p className="bg-black/30 px-2 py-1 rounded">
          CMAKE_ARGS="-DGGML_HIPBLAS=on" pip install llama-cpp-python --force-reinstall --no-cache-dir
        </p>
      </div>
    )
  }

  if (isWindows) {
    return (
      <div className="mt-2 space-y-1.5 text-xs text-yellow-200/70">
        <p>1. Install <a href="https://developer.nvidia.com/cuda-downloads" target="_blank" rel="noopener noreferrer" className="underline text-yellow-200 hover:text-white">CUDA Toolkit</a> from NVIDIA</p>
        <p>2. Reinstall llama-cpp-python:</p>
        <p className="bg-black/30 px-2 py-1 rounded font-mono">
          set CMAKE_ARGS=-DGGML_CUDA=on && pip install llama-cpp-python --force-reinstall --no-cache-dir
        </p>
      </div>
    )
  }

  // Linux (default)
  return (
    <div className="mt-2 space-y-1.5 text-xs text-yellow-200/70">
      <p>1. Install CUDA toolkit:</p>
      <p className="bg-black/30 px-2 py-1 rounded font-mono">
        {isLinux && 'sudo pacman -S cuda  # Arch  |  sudo apt install nvidia-cuda-toolkit  # Ubuntu'}
      </p>
      <p>2. Reinstall llama-cpp-python with CUDA:</p>
      <p className="bg-black/30 px-2 py-1 rounded font-mono">
        CMAKE_ARGS="-DGGML_CUDA=on" pip install llama-cpp-python --force-reinstall --no-cache-dir
      </p>
    </div>
  )
}

export function CpuOnlyBanner() {
  const [backend, setBackend] = useState<GpuBackend | null>(null)
  const [dismissed, setDismissed] = useState(false)
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    getGpuBackend().then(setBackend).catch(() => {})
  }, [])

  // Ne rien afficher si : Mac (metal), CUDA actif, ou dismissed
  if (!backend || backend.backend !== 'cpu' || dismissed) return null

  // GPU présent mais llama-cpp sans support GPU — cas critique
  const hasGpu = !!backend.gpu_name

  return (
    <div className="mx-4 mt-2 rounded-xl border border-yellow-500/30 bg-yellow-500/10 text-yellow-300 overflow-hidden">
      <div className="flex items-start gap-3 px-4 py-3">
        <span className="text-base shrink-0 mt-0.5">⚠</span>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold">
            {hasGpu
              ? `GPU detected (${backend.gpu_name}) but running on CPU`
              : 'Running on CPU — no GPU detected'}
          </p>
          <p className="text-xs text-yellow-200/70 mt-0.5">
            {hasGpu
              ? 'llama-cpp-python was installed without GPU support. Inference will be ~10x slower.'
              : 'No compatible GPU found. Inference will be slow.'}
          </p>

          {hasGpu && (
            <button
              onClick={() => setExpanded(e => !e)}
              className="text-xs text-yellow-200 underline mt-1 hover:text-white"
            >
              {expanded ? 'Hide fix instructions ▲' : 'How to fix ▼'}
            </button>
          )}

          {expanded && hasGpu && <InstallInstructions gpuName={backend.gpu_name} />}
        </div>
        <button
          onClick={() => setDismissed(true)}
          className="text-yellow-300/60 hover:text-yellow-200 shrink-0 text-lg leading-none"
          title="Dismiss"
        >
          ✕
        </button>
      </div>
    </div>
  )
}
