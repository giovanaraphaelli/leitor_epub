import { createBrowserRouter } from 'react-router-dom'
import Library from '@/pages/Library'
import Reader from '@/pages/Reader'

export const router = createBrowserRouter([
  { path: '/', element: <Library /> },
  { path: '/read/:bookId', element: <Reader /> },
])
