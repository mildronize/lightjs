import express, { Request, Response, NextFunction } from 'express';
import { ModuleMetadata } from '../decorators/interfaces/module-metadata.interface';
import { getMetadataArgsStore } from '../decorators/metadata';
import { RouteMetadataArgs } from '..';
import { MiddlewareMetadataArgs, RequestMethod } from '../decorators';
import { combineMiddlewares } from '../utils';
import { CombineRoute, combineRouteWithMiddleware } from './combine-route-with-middleware';
import { ReflectiveInjector, InjectionToken } from 'injection-js';

export interface ExpressAppOption {
  /**
   * **Global modules** to be imported
   */

  imports?: any[];

  /**
   * **Global Controllers**, these controllers will be injected in the Express app,
   * however, it cannot access the providers inside the modules.
   */

  controllers?: any[];

  /**
   * **Global providers**, these providers will be injected in all modules
   */

  providers?: any[];
}

export function useExpressServer(app: express.Application, option?: ExpressAppOption) {
  const controllerClasses = option?.controllers || [];
  const moduleClasses = option?.imports || [];

  /**
   * Using import module mode
   */

  moduleClasses.forEach((moduleClass) => {
    /**
     * create instance of modules, for bootstrapping some code in each module
     */
    createModuleInstance(moduleClass);

    const module = Reflect.getMetadata('module', moduleClass);
    addModuleToExpressApp(app, module, option);
  });

  /**
   * Using import controller only, strongly recommend to import with modules
   */

  if (controllerClasses.length > 0) addModuleToExpressApp(app, { controllers: controllerClasses }, option);

  return true;
}

function addModuleToExpressApp(app: express.Application, module: ModuleMetadata, option?: ExpressAppOption) {
  const store = getMetadataArgsStore();
  const controllers = module.controllers || [];
  const providers = module.providers || [];
  const globalProvidersClasses = option?.providers || [];

  controllers.forEach((controller) => {
    /**
     * Resolving the dependencies of controllers and services
     * Then, get controller instance
     */

    const injector = ReflectiveInjector.resolveAndCreate([controller, ...providers, ...globalProvidersClasses]);
    const controllerInstance = injector.get(controller) as typeof controller;

    const combinedRoutes = combineRouteWithMiddleware(controller, store.routes, store.middlewares);
    addRouterToExpress(app, combinedRoutes, controllerInstance);
  });
}

function addRouterToExpress(app: express.Application, combinedRoutes: CombineRoute[], controllerInstance: any) {
  const prefix = getPrefix(combinedRoutes);
  combinedRoutes.forEach((route: any) => {
    if (!route.isClass) {
      const requestMethod: RequestMethod = route.requestMethod;
      const routePath = combineRouterPath(prefix, route.path);

      if (route.middlewares.length > 0) {
        // Combine multiple middlewares
        const middleware = combineMiddlewares(...route.middlewares);
        app[requestMethod](routePath, middleware, callInstance(controllerInstance, route));
      } else {
        app[requestMethod](routePath, callInstance(controllerInstance, route));
      }
    }
  });
}

export const createModuleInstance = (moduleClass: any) => {
  return new moduleClass();
};

export const combineRouterPath = (prefix: string, path: string) => {
  let result = '';
  if (prefix !== '') {
    if (prefix.charAt(0) === '/') prefix = prefix.substring(1);
    result += prefix;
  }
  result += '/';
  if (path !== '') {
    if (path.charAt(0) === '/') path = path.substring(1);
    result += path;
  }
  if (result.charAt(0) !== '/') return '/' + result;
  return result;
};

const callInstance = (instance: any, route: RouteMetadataArgs) =>
  asyncHelper(async (req: Request, res: Response, next: NextFunction) => {
    await instance[route.methodName](req, res, next);
  });

export const getPrefix = (routes: any[]) => {
  for (const i in routes) if (routes[i].isClass) return routes[i].path;
  return '';
};

export const asyncHelper = (fn: any) => (req: Request, res: Response, next: NextFunction) => {
  fn(req, res, next).catch(next);
};
