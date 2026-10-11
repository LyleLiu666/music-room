// Local listening experiment. Link against the pinned, separately fetched library.
#include "rubberband/RubberBandStretcher.h"
#include <algorithm>
#include <cmath>
#include <fstream>
#include <iostream>
#include <stdexcept>
#include <vector>

int main(int argc, char **argv) {
 try {
  if (argc != 7) throw std::runtime_error("input.f32 output.f32 sampleRate channels rate full|short");
  const auto sr = std::stoul(argv[3]), channels = std::stoul(argv[4]);
  const auto rate = std::stod(argv[5]);
  if (sr < 8000 || sr > 96000 || channels < 1 || channels > 2 || !std::isfinite(rate) || rate < .5 || rate > 2)
   throw std::runtime_error("Invalid audio shape or rate");
  std::ifstream input(argv[1], std::ios::binary | std::ios::ate);
  if (!input) throw std::runtime_error("Cannot read input");
  const auto size = input.tellg();
  if (size <= 0 || size % (sizeof(float) * channels)) throw std::runtime_error("Invalid PCM length");
  std::vector<float> interleaved(size / sizeof(float));
  input.seekg(0); input.read(reinterpret_cast<char *>(interleaved.data()), size);
  const auto frames = interleaved.size() / channels;
  std::vector<std::vector<float>> planar(channels, std::vector<float>(frames));
  for (size_t i = 0; i < frames; ++i) for (size_t c = 0; c < channels; ++c) planar[c][i] = interleaved[i * channels + c];
  using RB = RubberBand::RubberBandStretcher;
  auto options = RB::OptionProcessOffline | RB::OptionEngineFiner | RB::OptionChannelsTogether;
  if (std::string(argv[6]) == "short") options |= RB::OptionWindowShort;
  else if (std::string(argv[6]) != "full") throw std::runtime_error("Unknown window mode");
  RB stretch(sr, channels, options, 1 / rate, 1);
  if (stretch.getEngineVersion() != 3) throw std::runtime_error("R3 engine unavailable");
  stretch.setExpectedInputDuration(frames);
  constexpr size_t block = 1024;
  stretch.setMaxProcessSize(block);
  std::vector<const float *> inputs(channels);
  for (size_t at = 0; at < frames; at += block) {
   const auto count = std::min(block, frames - at);
   for (size_t c = 0; c < channels; ++c) inputs[c] = planar[c].data() + at;
   stretch.study(inputs.data(), count, at + count == frames);
  }
  std::vector<std::vector<float>> output(channels, std::vector<float>(block));
  std::vector<float *> outputs(channels);
  for (size_t c = 0; c < channels; ++c) outputs[c] = output[c].data();
  std::vector<float> outBlock(block * channels);
  std::ofstream file(argv[2], std::ios::binary);
  if (!file) throw std::runtime_error("Cannot write output");
  size_t written = 0;
  for (size_t at = 0; at < frames; at += block) {
   const auto count = std::min(block, frames - at);
   for (size_t c = 0; c < channels; ++c) inputs[c] = planar[c].data() + at;
   stretch.process(inputs.data(), count, at + count == frames);
   while (stretch.available() > 0) {
    const auto got = stretch.retrieve(outputs.data(), block);
    if (!got) throw std::runtime_error("Output stalled");
    for (size_t i = 0; i < got; ++i) for (size_t c = 0; c < channels; ++c) outBlock[i * channels + c] = output[c][i];
    file.write(reinterpret_cast<const char *>(outBlock.data()), got * channels * sizeof(float));
    written += got;
   }
  }
  if (stretch.available() != -1 || !file) throw std::runtime_error("Incomplete output");
  std::cout << "frames=" << written << " engine=R3\n";
 } catch (const std::exception &e) { std::cerr << e.what() << '\n'; return 1; }
}
