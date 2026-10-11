// SPDX-License-Identifier: GPL-2.0-or-later
// Separate Music Room speed helper, linked with Rubber Band 4.0.0.
#include "rubberband/RubberBandStretcher.h"
#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <cstdlib>
#include <cstring>
#include <fstream>
#include <iostream>
#include <stdexcept>
#include <thread>
#include <vector>
#include <unistd.h>

constexpr size_t block = 1024;
static uint32_t u32(const unsigned char *p) { return uint32_t(p[0]) | uint32_t(p[1])<<8 | uint32_t(p[2])<<16 | uint32_t(p[3])<<24; }
static uint16_t u16(const unsigned char *p) { return uint16_t(p[0]) | uint16_t(p[1])<<8; }
static void put32(unsigned char *p, uint32_t n) { for (int i=0;i<4;++i) p[i]=(n>>(i*8))&255; }
static void put16(unsigned char *p, uint16_t n) { p[0]=n&255;p[1]=n>>8; }

int main(int argc, char **argv) {
 // EOF kills the helper even if its worker crashes or is SIGKILLed.
 std::thread([] { char data[64]; while (::read(STDIN_FILENO,data,sizeof(data))>0) {} std::_Exit(1); }).detach();
 try {
  if (argc!=4) throw std::runtime_error("input.wav output.wav rate required");
  size_t parsed=0;const double rate=std::stod(argv[3],&parsed);
  if(parsed!=std::strlen(argv[3])||!std::isfinite(rate)||rate<.5||rate>2) throw std::runtime_error("Invalid speed");
  std::ifstream input(argv[1],std::ios::binary|std::ios::ate);
  if(!input) throw std::runtime_error("Cannot open input");
  const auto inputBytes=input.tellg();input.seekg(0);
  std::array<unsigned char,44> header{};input.read(reinterpret_cast<char *>(header.data()),header.size());
  // The JS decoder validates user containers and supplies canonical 16-bit PCM.
  if(!input||std::memcmp(header.data(),"RIFF",4)||std::memcmp(header.data()+8,"WAVEfmt ",8)||
     u32(header.data()+16)!=16||u16(header.data()+20)!=1||u16(header.data()+34)!=16||
     std::memcmp(header.data()+36,"data",4)) throw std::runtime_error("Expected canonical PCM WAV");
  const auto channels=u16(header.data()+22);const auto sr=u32(header.data()+24),dataBytes=u32(header.data()+40);
  if(channels<1||channels>2||sr<8000||sr>96000||u16(header.data()+32)!=channels*2||
     u32(header.data()+28)!=sr*channels*2||dataBytes% (channels*2)||
     uint64_t(dataBytes)+44!=uint64_t(inputBytes)||uint64_t(u32(header.data()+4))+8!=uint64_t(inputBytes))
   throw std::runtime_error("Invalid PCM shape");
  const size_t frames=dataBytes/(channels*2),target=std::llround(frames/rate);
  if(!frames||frames>size_t(sr)*600||target*channels*2>UINT32_MAX-36) throw std::runtime_error("Invalid duration");
  using RB=RubberBand::RubberBandStretcher;
  RB stretch(sr,channels,RB::OptionProcessOffline|RB::OptionEngineFiner|RB::OptionChannelsTogether,1/rate,1);
  if(stretch.getEngineVersion()!=3) throw std::runtime_error("R3 engine required");
  stretch.setExpectedInputDuration(frames);stretch.setMaxProcessSize(block);
  std::vector<std::vector<float>> samples(channels,std::vector<float>(block));
  std::vector<const float *> inputs(channels);std::vector<float *> outputs(channels);
  for(size_t c=0;c<channels;++c){inputs[c]=samples[c].data();outputs[c]=samples[c].data();}
  std::vector<unsigned char> pcm(block*channels*2);
  auto readBlock=[&](size_t count){
   input.read(reinterpret_cast<char *>(pcm.data()),count*channels*2);
   if(!input) throw std::runtime_error("Truncated PCM");
   for(size_t i=0;i<count;++i)for(size_t c=0;c<channels;++c){
    const auto word=u16(pcm.data()+(i*channels+c)*2);const int value=word>=32768?int(word)-65536:int(word);
    samples[c][i]=value<0?value/32768.f:value/32767.f;
   }
  };
  for(size_t at=0;at<frames;at+=block){const auto count=std::min(block,frames-at);readBlock(count);stretch.study(inputs.data(),count,at+count==frames);}
  input.clear();input.seekg(44);
  // Spool float output so a single gain can protect peaks without clipping or pumping.
  const std::string spoolPath=std::string(argv[2])+".f32";
  std::ofstream spool(spoolPath,std::ios::binary);if(!spool)throw std::runtime_error("Cannot create spool");
  std::vector<float> interleaved(block*channels);size_t written=0;float peak=0;
  for(size_t at=0;at<frames;at+=block){
   const auto count=std::min(block,frames-at);readBlock(count);stretch.process(inputs.data(),count,at+count==frames);
   while(stretch.available()>0){
    const auto got=stretch.retrieve(outputs.data(),std::min<size_t>(block,stretch.available()));
    if(!got||written+got>target)throw std::runtime_error("Unexpected output length");
    for(size_t i=0;i<got;++i)for(size_t c=0;c<channels;++c){
     const float value=samples[c][i];if(!std::isfinite(value))throw std::runtime_error("Non-finite output");
     interleaved[i*channels+c]=value;peak=std::max(peak,std::abs(value));
    }
    spool.write(reinterpret_cast<const char *>(interleaved.data()),got*channels*sizeof(float));written+=got;
   }
  }
  spool.close();if(!spool||stretch.available()!=-1||written!=target)throw std::runtime_error("Incomplete output");
  std::ifstream rendered(spoolPath,std::ios::binary);std::ofstream output(argv[2],std::ios::binary);
  if(!rendered||!output)throw std::runtime_error("Cannot encode output");
  put32(header.data()+4,36+target*channels*2);put32(header.data()+40,target*channels*2);
  output.write(reinterpret_cast<const char *>(header.data()),header.size());
  const double gain=peak>.98f?.98/peak:1;
  for(size_t at=0;at<target;at+=block){
   const auto count=std::min(block,target-at)*channels;
   rendered.read(reinterpret_cast<char *>(interleaved.data()),count*sizeof(float));if(!rendered)throw std::runtime_error("Truncated spool");
   for(size_t i=0;i<count;++i){const double v=interleaved[i]*gain;const int value=int(std::floor(v*(v<0?32768:32767)+.5));put16(pcm.data()+i*2,uint16_t(value));}
   output.write(reinterpret_cast<const char *>(pcm.data()),count*2);
  }
  output.close();if(!output)throw std::runtime_error("Cannot finish output");
  rendered.close();std::remove(spoolPath.c_str());
 } catch(const std::exception &e){std::cerr<<e.what()<<'\n';return 1;}
}
