import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    redirectTo: '/app',
    pathMatch: 'full'
  },
  {
    path: 'app',
    loadComponent: () => import('./app.component').then(m => m.AppComponent)
  },
  {
    path: 'lobby', 
    loadComponent: () => import('./app.component').then(m => m.AppComponent)
  },
  {
    path: 'call/:roomId',
    loadComponent: () => import('./app.component').then(m => m.AppComponent)
  },
  {
    path: '**',
    redirectTo: '/app'
  }
];