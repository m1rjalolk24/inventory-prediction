import { createContext, useContext, useState, useEffect } from 'react'

const AuthContext = createContext(null)

function parseToken(token) {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]))
    if (payload.exp * 1000 < Date.now()) return null
    return { username: payload.username, role: payload.role }
  } catch {
    return null
  }
}

export function AuthProvider({ children }) {
  const [user,    setUser]    = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const token = localStorage.getItem('token')
    if (token) {
      const parsed = parseToken(token)
      if (parsed) setUser(parsed)
      else localStorage.removeItem('token')
    }
    setLoading(false)
  }, [])

  const login = async (username, password) => {
    const res  = await fetch('/api/v1/auth/login', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ username, password }),
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error)
    localStorage.setItem('token', data.token)
    setUser({ username: data.username, role: data.role })
  }

  const logout = () => {
    localStorage.removeItem('token')
    setUser(null)
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)

/** Include in every authenticated fetch call */
export function authHeaders() {
  const token = localStorage.getItem('token')
  return token ? { Authorization: `Bearer ${token}` } : {}
}
