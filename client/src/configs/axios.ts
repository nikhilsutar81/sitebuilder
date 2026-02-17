import axios from 'axios';

const api = axios.create({
    baseURL: import.meta.env.VITE_BASEURL || 'http://localhost:3000',
    withCredentials: true,
    timeout: 120000 // 120 seconds timeout for long-running operations
})

export default api