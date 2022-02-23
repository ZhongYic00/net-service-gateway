FROM  mhart/alpine-node:14.17.3
ADD . /app
RUN cd /app/ \
    && npm config set registry https://registry.npm.taobao.org \
#    && yarn add .