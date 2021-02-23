import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import path from 'path';

import { ProtoGrpcType } from '../generated/reflection';
import { ServerReflectionRequest } from '../generated/grpc/reflection/v1alpha/ServerReflectionRequest';
import { ServerReflectionResponse } from '../generated/grpc/reflection/v1alpha/ServerReflectionResponse';
import { ServerReflectionHandlers } from '../generated/grpc/reflection/v1alpha/ServerReflection';
import { ListServiceResponse } from '../generated/grpc/reflection/v1alpha/ListServiceResponse';

const getServiceNameFromServiceDefinition = (
  serviceDefinition: protoLoader.ServiceDefinition,
) => {
  // We retrieve the service name from the path of the first method definition we get
  const methodDefinition = Object.values(serviceDefinition).shift();
  // We expect the path to have the following format /${serviceName}/${methodName}
  return methodDefinition.path.split('/')[1];
};

const createListServicesResponse = (
  services: protoLoader.ServiceDefinition[],
): ListServiceResponse => ({
  service: services.map((serviceDefinition) => {
    const name = getServiceNameFromServiceDefinition(serviceDefinition);
    return {
      name,
    };
  }),
});

const createServerReflectionInfoHandler = (
  services: protoLoader.ServiceDefinition[],
): grpc.handleBidiStreamingCall<
  ServerReflectionRequest,
  ServerReflectionResponse
> => (call) => {
  call.on('data', (request: ServerReflectionRequest) => {
    if (request.listServices) {
      const response: ServerReflectionResponse = {
        listServicesResponse: createListServicesResponse(services),
      };
      call.write(response);
    }
  });

  call.on('end', () => {
    call.end();
  });
};

const createServerReflectionServiceHandlers = (
  services: protoLoader.ServiceDefinition[],
): ServerReflectionHandlers => ({
  ServerReflectionInfo: createServerReflectionInfoHandler(services),
});

const serverWithRefelection = (server: grpc.Server): grpc.Server => {
  const services: protoLoader.ServiceDefinition[] = [];

  const addService = (service: protoLoader.ServiceDefinition) => {
    services.push(service);
  };

  // We create a proxy based on the initial grpc.Server.
  // This allows us to intercept the `addService` method to keep track
  // of all services added to the server.
  const serverProxy = new Proxy(server, {
    get: (target, p, receiver) => {
      if (p === 'addService') {
        return (
          service: protoLoader.ServiceDefinition,
          implementation: grpc.UntypedServiceImplementation,
        ) => {
          // We keep track of all services added to the gRPC service.
          addService(service);
          return target.addService(service, implementation);
        };
      }

      return Reflect.get(target, p, receiver);
    },
  });

  const serverReflectionPackageDefinition = protoLoader.loadSync(
    `${path.resolve(__dirname)}/proto/grpc/reflection/v1alpha/reflection.proto`,
  );

  const packageObject = (grpc.loadPackageDefinition(
    serverReflectionPackageDefinition,
  ) as unknown) as ProtoGrpcType;

  const reflectionService =
    packageObject.grpc.reflection.v1alpha.ServerReflection.service;

  const handlers = createServerReflectionServiceHandlers(services);
  serverProxy.addService(reflectionService, handlers);

  return serverProxy;
};

export default serverWithRefelection;