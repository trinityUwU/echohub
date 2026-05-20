import { useToast } from '@/hooks/useToast'
import { ToastList } from '@/components/shared/Toast'

export function Toaster(): React.ReactElement {
  const { toasts } = useToast()

  return (
    <div className="fixed bottom-4 right-4 z-50 pointer-events-none">
      <ToastList toasts={toasts} />
    </div>
  )
}
