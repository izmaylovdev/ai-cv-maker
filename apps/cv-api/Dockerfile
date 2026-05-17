FROM mcr.microsoft.com/dotnet/sdk:9.0 AS build
WORKDIR /src
COPY proto/ proto/
COPY apps/cv-api/cv-api.csproj apps/cv-api/
RUN dotnet restore apps/cv-api/cv-api.csproj
COPY apps/cv-api/ apps/cv-api/
WORKDIR /src/apps/cv-api
RUN dotnet publish -c Release -o /app/publish

FROM mcr.microsoft.com/dotnet/aspnet:9.0 AS runtime
WORKDIR /app
COPY --from=build /app/publish .
EXPOSE 8080
ENTRYPOINT ["dotnet", "cv-api.dll"]
