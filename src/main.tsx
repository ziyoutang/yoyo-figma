import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { AuthGate } from './AuthGate';
import { Workflow } from './Workflow';
import './styles.css';

ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><BrowserRouter><AuthGate>{user => <Workflow key={user.uid} uid={user.uid}/>}</AuthGate></BrowserRouter></React.StrictMode>);
